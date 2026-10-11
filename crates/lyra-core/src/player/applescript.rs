//! In-process AppleScript execution shared by the macOS AppleScript adapters.
//!
//! NSAppleScript objects are not thread-safe. Every compile, execute and
//! release goes through `APPLESCRIPT_LOCK`, so polls (GCD queue) and commands
//! (blocking pool) never run scripts concurrently.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};

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

/// Retained NSAppleScript pointer. Send/Sync rely on `APPLESCRIPT_LOCK`.
struct CompiledScript {
    ptr: *mut Object,
}

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

    fn ptr(&self) -> *mut Object {
        self.compiled
            .get_or_init(|| CompiledScript {
                ptr: compile(self.source).unwrap_or(std::ptr::null_mut()),
            })
            .ptr
    }

    /// The script's result as text; `None` if it failed to run.
    pub(crate) fn run(&self) -> Option<String> {
        self.run_checked().ok()
    }

    /// Like `run`, but tells a permission refusal apart from other failures.
    pub(crate) fn run_checked(&self) -> Result<String, RunError> {
        match execute(self.ptr(), Output::Text)? {
            Value::Text(text) => Ok(text),
            Value::Data(_) => Err(RunError::Failed),
        }
    }

    /// The script's result as raw bytes (e.g. artwork data).
    pub(crate) fn run_data(&self) -> Option<Vec<u8>> {
        match execute(self.ptr(), Output::Data).ok()? {
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
    let ptr = compile(source)?;
    let result = match execute(ptr, Output::Text) {
        Ok(Value::Text(text)) => Some(text),
        _ => None,
    };
    let _guard = APPLESCRIPT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        let _: () = msg_send![ptr, release];
    }
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

fn compile(source: &str) -> Option<*mut Object> {
    let _guard = APPLESCRIPT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let bytes = source.as_bytes();
        let str_alloc: *mut Object = msg_send![class!(NSString), alloc];
        let src_str: *mut Object = msg_send![
            str_alloc,
            initWithBytes: bytes.as_ptr()
            length: bytes.len()
            encoding: 4u64
        ];
        let s_alloc: *mut Object = msg_send![class!(NSAppleScript), alloc];
        let script: *mut Object = msg_send![s_alloc, initWithSource: src_str];
        let _: () = msg_send![src_str, release];

        if script.is_null() {
            let _: () = msg_send![pool, drain];
            return None;
        }

        // Pre-compile so the first execute call doesn't pay the parse cost.
        let mut compile_err: *mut Object = std::ptr::null_mut();
        let _: bool = msg_send![script, compileAndReturnError: &mut compile_err];

        let _: () = msg_send![pool, drain];
        Some(script)
    }
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
fn execute(script_ptr: *mut Object, output: Output) -> Result<Value, RunError> {
    if script_ptr.is_null() {
        return Err(RunError::Failed);
    }
    let _guard = APPLESCRIPT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let mut err_ptr: *mut Object = std::ptr::null_mut();
        let desc: *mut Object = msg_send![script_ptr, executeAndReturnError: &mut err_ptr];
        let result = if desc.is_null() {
            if error_number(err_ptr) == Some(ERR_NOT_PERMITTED) {
                Err(RunError::NotPermitted)
            } else {
                Err(RunError::Failed)
            }
        } else {
            match output {
                Output::Text => descriptor_text(desc).map(Value::Text),
                Output::Data => descriptor_data(desc).map(Value::Data),
            }
            .ok_or(RunError::Failed)
        };
        let _: () = msg_send![pool, drain];
        result
    }
}

/// `NSAppleScriptErrorNumber` from an execute error dictionary.
unsafe fn error_number(err: *mut Object) -> Option<i64> {
    if err.is_null() {
        return None;
    }
    let key: *mut Object = msg_send![
        class!(NSString),
        stringWithUTF8String: c"NSAppleScriptErrorNumber".as_ptr()
    ];
    let number: *mut Object = msg_send![err, objectForKey: key];
    if number.is_null() {
        return None;
    }
    let value: i64 = msg_send![number, longLongValue];
    Some(value)
}

unsafe fn descriptor_text(desc: *mut Object) -> Option<String> {
    let val: *mut Object = msg_send![desc, stringValue];
    if val.is_null() {
        return None;
    }
    let utf8: *const std::ffi::c_char = msg_send![val, UTF8String];
    if utf8.is_null() {
        return None;
    }
    let c_str = std::ffi::CStr::from_ptr(utf8);
    Some(c_str.to_string_lossy().trim().to_string())
}

unsafe fn descriptor_data(desc: *mut Object) -> Option<Vec<u8>> {
    let data: *mut Object = msg_send![desc, data];
    if data.is_null() {
        return None;
    }
    let len: usize = msg_send![data, length];
    let bytes: *const u8 = msg_send![data, bytes];
    if bytes.is_null() || len == 0 {
        return None;
    }
    Some(std::slice::from_raw_parts(bytes, len).to_vec())
}

#[cfg(test)]
mod tests {
    use super::{automation_denied, note_permission, parse_number};

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
}
