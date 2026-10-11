//! In-process AppleScript execution shared by the macOS AppleScript adapters.
//!
//! NSAppleScript objects are not thread-safe. Every compile, execute and
//! release goes through `APPLESCRIPT_LOCK`, so polls (GCD queue) and commands
//! (blocking pool) never run scripts concurrently.

use std::sync::{Mutex, OnceLock};

use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};

static APPLESCRIPT_LOCK: Mutex<()> = Mutex::new(());

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
        match execute(self.ptr(), Output::Text)? {
            Value::Text(text) => Some(text),
            Value::Data(_) => None,
        }
    }

    /// The script's result as raw bytes (e.g. artwork data).
    pub(crate) fn run_data(&self) -> Option<Vec<u8>> {
        match execute(self.ptr(), Output::Data)? {
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
        Some(Value::Text(text)) => Some(text),
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

/// Run a compiled script and read its result in the requested form; `None`
/// means the script failed.
fn execute(script_ptr: *mut Object, output: Output) -> Option<Value> {
    if script_ptr.is_null() {
        return None;
    }
    let _guard = APPLESCRIPT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let mut err_ptr: *mut Object = std::ptr::null_mut();
        let desc: *mut Object = msg_send![script_ptr, executeAndReturnError: &mut err_ptr];
        let result = if desc.is_null() {
            None
        } else {
            match output {
                Output::Text => descriptor_text(desc).map(Value::Text),
                Output::Data => descriptor_data(desc).map(Value::Data),
            }
        };
        let _: () = msg_send![pool, drain];
        result
    }
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
    use super::parse_number;

    #[test]
    fn numbers_parse_with_either_decimal_separator() {
        assert_eq!(parse_number("12.5"), Some(12.5));
        assert_eq!(parse_number("12,5"), Some(12.5));
        assert_eq!(parse_number(" 214 "), Some(214.0));
        assert_eq!(parse_number("missing value"), None);
    }
}
