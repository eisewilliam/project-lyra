//! In-process AppleScript execution shared by the macOS AppleScript adapters.
//!
//! NSAppleScript objects are not thread-safe. Every compile, execute and
//! release goes through `APPLESCRIPT_LOCK`, so polls (GCD queue) and commands
//! (blocking pool) never run scripts concurrently.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::AnyObject;
use objc2::{msg_send, AllocAnyThread};
use objc2_foundation::{
    NSAppleEventDescriptor, NSAppleScript, NSAppleScriptErrorNumber, NSData, NSDictionary,
    NSNumber, NSString,
};

static APPLESCRIPT_LOCK: Mutex<()> = Mutex::new(());

/// AppleScript readers stay idle until the host enables them, so macOS asks
/// for permission to control Spotify or Music only after Lyra has explained
/// why (first run). Players remain visible through MediaRemote meanwhile.
static AUTOMATION_ENABLED: AtomicBool = AtomicBool::new(true);

/// Players whose scripts macOS refused (Automation permission denied or
/// revoked), by display name, in the order they were refused.
static DENIED: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());

/// `errAEEventNotPermitted`: the user declined Automation access.
const ERR_NOT_PERMITTED: i64 = -1743;

/// Enable or pause the AppleScript readers.
pub fn set_automation_enabled(enabled: bool) {
    AUTOMATION_ENABLED.store(enabled, Ordering::Release);
}

pub(crate) fn automation_enabled() -> bool {
    AUTOMATION_ENABLED.load(Ordering::Acquire)
}

/// Players Lyra may not control because Automation access was refused.
pub fn automation_denied() -> Vec<String> {
    DENIED
        .lock()
        .map(|denied| denied.iter().map(|name| name.to_string()).collect())
        .unwrap_or_default()
}

/// Record the outcome of a reader's poll for `player`.
pub(crate) fn note_permission(player: &'static str, denied: bool) {
    let Ok(mut list) = DENIED.lock() else {
        return;
    };
    let present = list.contains(&player);
    if denied && !present {
        list.push(player);
    } else if !denied && present {
        list.retain(|name| *name != player);
    }
}

/// Why a script produced no result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RunError {
    /// macOS refused Automation access to the target app.
    NotPermitted,
    Failed,
}

/// A compiled script, or `None` if it failed to compile. Send/Sync rely on
/// `APPLESCRIPT_LOCK`.
struct CompiledScript(Option<Retained<NSAppleScript>>);

unsafe impl Send for CompiledScript {}
unsafe impl Sync for CompiledScript {}

/// A script compiled on first use and kept for the process lifetime, so
/// repeated polls skip the parse stage.
pub(crate) struct Script {
    source: &'static str,
    compiled: OnceLock<CompiledScript>,
}

impl Script {
    pub(crate) const fn new(source: &'static str) -> Self {
        Self {
            source,
            compiled: OnceLock::new(),
        }
    }

    fn compiled(&self) -> Option<&NSAppleScript> {
        self.compiled
            .get_or_init(|| CompiledScript(compile(self.source)))
            .0
            .as_deref()
    }

    /// The script's result as text; `None` if it failed to run.
    pub(crate) fn run(&self) -> Option<String> {
        self.run_checked().ok()
    }

    /// Like `run`, but tells a permission refusal apart from other failures.
    pub(crate) fn run_checked(&self) -> Result<String, RunError> {
        match execute(self.compiled(), Output::Text)? {
            Value::Text(text) => Ok(text),
            Value::Data(_) => Err(RunError::Failed),
        }
    }

    /// The script's result as raw bytes (e.g. artwork data).
    pub(crate) fn run_data(&self) -> Option<Vec<u8>> {
        match execute(self.compiled(), Output::Data).ok()? {
            Value::Data(data) => Some(data),
            Value::Text(_) => None,
        }
    }

    /// Commands return "true" only when the target app was running and the
    /// command was sent.
    pub(crate) fn run_command(&self) -> bool {
        self.run().as_deref() == Some("true")
    }
}

/// Run a one-off script (e.g. one with a formatted seek position) and release
/// it afterwards.
pub(crate) fn run_once(source: &str) -> Option<String> {
    let script = compile(source)?;
    let result = match execute(Some(&script), Output::Text) {
        Ok(Value::Text(text)) => Some(text),
        _ => None,
    };
    let _guard = lock();
    drop(script);
    result
}

/// AppleScript formats reals with the user's decimal separator.
pub(crate) fn parse_number(raw: &str) -> Option<f64> {
    raw.trim()
        .replace(',', ".")
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
}

fn lock() -> MutexGuard<'static, ()> {
    APPLESCRIPT_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn compile(source: &str) -> Option<Retained<NSAppleScript>> {
    let _guard = lock();
    autoreleasepool(|_| {
        let source = NSString::from_str(source);
        let script = NSAppleScript::initWithSource(NSAppleScript::alloc(), &source)?;
        // Pre-compile so the first execute call doesn't pay the parse cost.
        // SAFETY: the error out-parameter may be null.
        let _ = unsafe { script.compileAndReturnError(None) };
        Some(script)
    })
}

enum Output {
    Text,
    Data,
}

enum Value {
    Text(String),
    Data(Vec<u8>),
}

/// Run a compiled script and read its result in the requested form.
fn execute(script: Option<&NSAppleScript>, output: Output) -> Result<Value, RunError> {
    let script = script.ok_or(RunError::Failed)?;
    let _guard = lock();
    autoreleasepool(|_| {
        let mut error: Option<Retained<NSDictionary<NSString, AnyObject>>> = None;
        // `executeAndReturnError:` returns nil when the script fails, which the
        // generated binding doesn't allow for, so declare the optional result.
        // SAFETY: the selector takes an error out-parameter and returns a
        // descriptor or nil.
        let descriptor: Option<Retained<NSAppleEventDescriptor>> =
            unsafe { msg_send![script, executeAndReturnError: Some(&mut error)] };
        let Some(descriptor) = descriptor else {
            return Err(match error_number(error.as_deref()) {
                Some(ERR_NOT_PERMITTED) => RunError::NotPermitted,
                _ => RunError::Failed,
            });
        };
        match output {
            Output::Text => descriptor
                .stringValue()
                .map(|text| Value::Text(text.to_string().trim().to_string())),
            Output::Data => descriptor_data(&descriptor).map(Value::Data),
        }
        .ok_or(RunError::Failed)
    })
}

/// `NSAppleScriptErrorNumber` from an execute error dictionary.
fn error_number(error: Option<&NSDictionary<NSString, AnyObject>>) -> Option<i64> {
    // SAFETY: an immutable string constant exported by Foundation.
    let key = unsafe { NSAppleScriptErrorNumber };
    let value = error?.objectForKey(key)?;
    Some(value.downcast_ref::<NSNumber>()?.longLongValue())
}

fn descriptor_data(descriptor: &NSAppleEventDescriptor) -> Option<Vec<u8>> {
    // SAFETY: `data` returns the descriptor's bytes as NSData; declared
    // optional in case a descriptor has none.
    let data: Option<Retained<NSData>> = unsafe { msg_send![descriptor, data] };
    let bytes = data?.to_vec();
    (!bytes.is_empty()).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::{automation_denied, note_permission, parse_number, run_once, RunError, Script};

    #[test]
    fn numbers_parse_with_either_decimal_separator() {
        assert_eq!(parse_number("12.5"), Some(12.5));
        assert_eq!(parse_number("12,5"), Some(12.5));
        assert_eq!(parse_number(" 214 "), Some(214.0));
        assert_eq!(parse_number("missing value"), None);
    }

    #[test]
    fn refusal_is_recorded_once_and_cleared_on_success() {
        note_permission("Test Player", true);
        note_permission("Test Player", true);
        let denied = automation_denied();
        assert_eq!(denied.iter().filter(|n| *n == "Test Player").count(), 1);
        note_permission("Test Player", false);
        assert!(!automation_denied().iter().any(|n| n == "Test Player"));
    }

    // These run in-process and target no other app, so they need no
    // Automation permission.

    #[test]
    fn scripts_return_text() {
        static GREETING: Script = Script::new(r#"return "  hello  ""#);
        assert_eq!(GREETING.run().as_deref(), Some("hello"));
        assert_eq!(GREETING.run().as_deref(), Some("hello"));
        assert_eq!(run_once("return 1 + 2").as_deref(), Some("3"));
    }

    #[test]
    fn script_errors_are_told_apart() {
        static REFUSED: Script = Script::new(r#"error "refused" number -1743"#);
        static BROKEN: Script = Script::new(r#"error "broken" number 42"#);
        static UNPARSABLE: Script = Script::new("return (");
        assert_eq!(REFUSED.run_checked(), Err(RunError::NotPermitted));
        assert_eq!(BROKEN.run_checked(), Err(RunError::Failed));
        assert_eq!(UNPARSABLE.run_checked(), Err(RunError::Failed));
        assert_eq!(run_once("return ("), None);
    }

    #[test]
    fn scripts_return_raw_data() {
        static BYTES: Script = Script::new("return «data rdatCAFE»");
        assert_eq!(BYTES.run_data(), Some(vec![0xCA, 0xFE]));
    }
}
