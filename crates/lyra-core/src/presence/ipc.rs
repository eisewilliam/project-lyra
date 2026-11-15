//! Discord's local RPC connection: a Unix socket or Windows named pipe the
//! desktop client listens on, carrying length-prefixed JSON frames.
//!
//! Every read has a deadline. The client can accept a connection and then
//! say nothing (while it starts up or updates), and a blocked read would
//! hold the presence worker forever.

use std::io;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::activity::Activity;

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

const RPC_VERSION: u32 = 1;
/// Sockets are numbered per running client (stable, PTB, Canary, …).
const MAX_PIPES: u32 = 10;
const REPLY_TIMEOUT: Duration = Duration::from_secs(3);
/// Wait for frames that may already be queued, without stalling the worker.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(1);
/// The largest frame Discord sends is the READY event with the user object.
const MAX_FRAME_BYTES: usize = 1 << 20;

/// A byte stream to the Discord client.
pub(crate) trait Pipe: Send {
    fn write_all(&mut self, bytes: &[u8]) -> io::Result<()>;

    /// Read up to `buf.len()` bytes, waiting at most `timeout`. `Ok(0)`
    /// means nothing arrived in time; a closed stream is an error.
    fn read_some(&mut self, buf: &mut [u8], timeout: Duration) -> io::Result<usize>;
}

pub(crate) struct Connection {
    pipe: Box<dyn Pipe>,
    next_nonce: u64,
}

impl Connection {
    /// Connect to the first Discord client that completes the handshake.
    pub(crate) fn open(application_id: &str) -> io::Result<Self> {
        let mut last_error = io::Error::new(io::ErrorKind::NotFound, "Discord is not running");
        for index in 0..MAX_PIPES {
            for pipe in platform::connect(index) {
                // A socket file can outlive its client, so a failed
                // candidate must not end the search.
                match Self::handshake(pipe, application_id) {
                    Ok(connection) => return Ok(connection),
                    Err(error) => last_error = error,
                }
            }
        }
        Err(last_error)
    }

    pub(crate) fn handshake(pipe: Box<dyn Pipe>, application_id: &str) -> io::Result<Self> {
        let mut connection = Self {
            pipe,
            next_nonce: 0,
        };
        connection.send(
            OP_HANDSHAKE,
            &json!({ "v": RPC_VERSION, "client_id": application_id }),
        )?;
        let deadline = Instant::now() + REPLY_TIMEOUT;
        loop {
            let Some(body) = connection.next_message(deadline)? else {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Discord did not answer the handshake",
                ));
            };
            if body["evt"] == "READY" {
                return Ok(connection);
            }
            if body["evt"] == "ERROR" {
                return Err(rejected(&body));
            }
        }
    }

    /// Show `activity` on the user's profile, or clear it with `None`.
    /// Returns Discord's message when it refuses the activity; the
    /// connection stays usable either way.
    pub(crate) fn set_activity(
        &mut self,
        activity: Option<&Activity>,
    ) -> io::Result<Option<String>> {
        self.next_nonce += 1;
        let nonce = format!("lyra-{}-{}", std::process::id(), self.next_nonce);
        self.send(
            OP_FRAME,
            &json!({
                "cmd": "SET_ACTIVITY",
                "args": { "pid": std::process::id(), "activity": activity },
                "nonce": nonce,
            }),
        )?;
        let deadline = Instant::now() + REPLY_TIMEOUT;
        while let Some(body) = self.next_message(deadline)? {
            if body["nonce"] == nonce.as_str() {
                return Ok((body["evt"] == "ERROR").then(|| {
                    body["data"]["message"]
                        .as_str()
                        .unwrap_or("rejected")
                        .to_owned()
                }));
            }
        }
        // No reply in time: Discord is busy, not gone.
        Ok(None)
    }

    /// Answer pings and notice a closed connection. Call while idle; fails
    /// once Discord has quit.
    pub(crate) fn drain(&mut self) -> io::Result<()> {
        while self.next_message(Instant::now() + DRAIN_TIMEOUT)?.is_some() {}
        Ok(())
    }

    /// Clear the activity and tell Discord the connection is ending.
    pub(crate) fn close(mut self) {
        let _ = self.set_activity(None);
        let _ = self.send(OP_CLOSE, &json!({}));
    }

    /// The next command reply or event, or `None` when nothing arrives by
    /// `deadline`. Pings are answered here; a close frame is an error.
    fn next_message(&mut self, deadline: Instant) -> io::Result<Option<Value>> {
        loop {
            let Some((opcode, body)) = self.read_frame(deadline)? else {
                return Ok(None);
            };
            match opcode {
                OP_FRAME => {
                    return serde_json::from_slice(&body)
                        .map(Some)
                        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e));
                }
                OP_PING => self.write_frame(OP_PONG, &body)?,
                OP_CLOSE => {
                    let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                    return Err(rejected(&body));
                }
                _ => {}
            }
        }
    }

    fn send(&mut self, opcode: u32, body: &Value) -> io::Result<()> {
        self.write_frame(opcode, body.to_string().as_bytes())
    }

    fn write_frame(&mut self, opcode: u32, body: &[u8]) -> io::Result<()> {
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&opcode.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(body);
        self.pipe.write_all(&frame)
    }

    /// One frame, or `None` when no frame starts before `deadline`. A frame
    /// that starts is read to its end: stopping midway would leave the
    /// stream out of step.
    fn read_frame(&mut self, deadline: Instant) -> io::Result<Option<(u32, Vec<u8>)>> {
        let mut header = [0u8; 8];
        let first = self.pipe.read_some(
            &mut header,
            deadline.saturating_duration_since(Instant::now()),
        )?;
        if first == 0 {
            return Ok(None);
        }
        let frame_deadline = Instant::now() + REPLY_TIMEOUT;
        self.read_exact(&mut header[first..], frame_deadline)?;
        let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
        if length > MAX_FRAME_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "oversized Discord frame",
            ));
        }
        let mut body = vec![0u8; length];
        self.read_exact(&mut body, frame_deadline)?;
        Ok(Some((opcode, body)))
    }

    fn read_exact(&mut self, mut buf: &mut [u8], deadline: Instant) -> io::Result<()> {
        while !buf.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Discord stopped mid-frame",
                ));
            }
            let read = self.pipe.read_some(buf, remaining)?;
            buf = &mut buf[read..];
        }
        Ok(())
    }
}

fn rejected(body: &Value) -> io::Error {
    let data = if body["data"].is_object() {
        &body["data"]
    } else {
        body
    };
    io::Error::new(
        io::ErrorKind::ConnectionAborted,
        format!(
            "Discord closed the connection: {} {}",
            data["code"],
            data["message"].as_str().unwrap_or_default()
        ),
    )
}

#[cfg(unix)]
mod platform {
    use std::io::{self, Read, Write};
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;
    use std::time::Duration;

    use super::Pipe;

    /// Where sandboxed Linux clients put the socket, under the runtime dir.
    #[cfg(target_os = "linux")]
    const CLIENT_DIRS: &[&str] = &[
        "",
        "app/com.discordapp.Discord",
        "app/dev.vencord.Vesktop",
        ".flatpak/com.discordapp.Discord/xdg-run",
        ".flatpak/dev.vencord.Vesktop/xdg-run",
        "snap.discord",
        "snap.discord-canary",
    ];
    #[cfg(not(target_os = "linux"))]
    const CLIENT_DIRS: &[&str] = &[""];

    const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

    impl Pipe for UnixStream {
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            Write::write_all(self, bytes)
        }

        fn read_some(&mut self, buf: &mut [u8], timeout: Duration) -> io::Result<usize> {
            // A zero timeout is rejected by the OS as "block forever". macOS
            // refuses to set a timeout once the peer has closed; the read
            // below then returns what is left or end-of-stream at once, so
            // the failure is safe to ignore.
            let _ = self.set_read_timeout(Some(timeout.max(Duration::from_millis(1))));
            match self.read(buf) {
                Ok(0) => Err(io::ErrorKind::UnexpectedEof.into()),
                Ok(read) => Ok(read),
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock
                            | io::ErrorKind::TimedOut
                            | io::ErrorKind::Interrupted
                    ) =>
                {
                    Ok(0)
                }
                Err(e) => Err(e),
            }
        }
    }

    /// Open sockets numbered `index` in every place a client may put one.
    pub(super) fn connect(index: u32) -> Vec<Box<dyn Pipe>> {
        let mut roots: Vec<PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
            .iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .collect();
        roots.push(PathBuf::from("/tmp"));
        roots.dedup();

        let mut pipes: Vec<Box<dyn Pipe>> = Vec::new();
        for root in &roots {
            for dir in CLIENT_DIRS {
                let path = root.join(dir).join(format!("discord-ipc-{index}"));
                let Ok(stream) = UnixStream::connect(&path) else {
                    continue;
                };
                if stream.set_write_timeout(Some(WRITE_TIMEOUT)).is_ok() {
                    pipes.push(Box::new(stream));
                }
            }
        }
        pipes
    }
}

#[cfg(windows)]
mod platform {
    use std::fs::{File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::os::windows::io::AsRawHandle;
    use std::time::{Duration, Instant};

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Pipes::PeekNamedPipe;

    use super::Pipe;

    /// Named pipes opened as files have no read timeout, so reads wait for
    /// bytes to be available first.
    const POLL_INTERVAL: Duration = Duration::from_millis(15);

    struct NamedPipe(File);

    impl NamedPipe {
        /// Bytes ready to read; fails once Discord has closed its end.
        fn available(&self) -> io::Result<usize> {
            let mut available = 0u32;
            // SAFETY: the handle is an open pipe owned by `self.0`, and
            // `available` outlives the call. No buffer is passed.
            unsafe {
                PeekNamedPipe(
                    HANDLE(self.0.as_raw_handle()),
                    None,
                    0,
                    None,
                    Some(&mut available),
                    None,
                )
            }
            .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
            Ok(available as usize)
        }
    }

    impl Pipe for NamedPipe {
        fn write_all(&mut self, bytes: &[u8]) -> io::Result<()> {
            self.0.write_all(bytes)
        }

        fn read_some(&mut self, buf: &mut [u8], timeout: Duration) -> io::Result<usize> {
            let deadline = Instant::now() + timeout;
            loop {
                let available = self.available()?;
                if available > 0 {
                    let wanted = available.min(buf.len());
                    return self.0.read(&mut buf[..wanted]);
                }
                if Instant::now() >= deadline {
                    return Ok(0);
                }
                std::thread::sleep(POLL_INTERVAL);
            }
        }
    }

    pub(super) fn connect(index: u32) -> Vec<Box<dyn Pipe>> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(format!(r"\\?\pipe\discord-ipc-{index}"))
            .map(|file| Box::new(NamedPipe(file)) as Box<dyn Pipe>)
            .into_iter()
            .collect()
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use super::Pipe;

    pub(super) fn connect(_index: u32) -> Vec<Box<dyn Pipe>> {
        Vec::new()
    }
}

#[cfg(all(test, unix))]
pub(crate) mod test_support {
    //! A stand-in Discord client on the other end of a socket pair.

    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;

    use serde_json::{json, Value};

    use super::*;

    pub(crate) struct FakeDiscord(pub UnixStream);

    impl FakeDiscord {
        pub(crate) fn pair() -> (Box<dyn Pipe>, Self) {
            let (ours, theirs) = UnixStream::pair().unwrap();
            theirs
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            (Box::new(ours), Self(theirs))
        }

        pub(crate) fn read(&mut self) -> (u32, Value) {
            let mut header = [0u8; 8];
            self.0.read_exact(&mut header).unwrap();
            let opcode = u32::from_le_bytes(header[..4].try_into().unwrap());
            let mut body = vec![0u8; u32::from_le_bytes(header[4..].try_into().unwrap()) as usize];
            self.0.read_exact(&mut body).unwrap();
            (opcode, serde_json::from_slice(&body).unwrap())
        }

        pub(crate) fn write(&mut self, opcode: u32, body: &Value) {
            let body = body.to_string();
            let mut frame = opcode.to_le_bytes().to_vec();
            frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
            frame.extend_from_slice(body.as_bytes());
            Write::write_all(&mut self.0, &frame).unwrap();
        }

        /// Read the handshake and answer it as a running client does.
        pub(crate) fn accept(&mut self) -> Value {
            let (opcode, body) = self.read();
            assert_eq!(opcode, OP_HANDSHAKE);
            self.write(
                OP_FRAME,
                &json!({ "cmd": "DISPATCH", "evt": "READY", "data": { "v": 1 } }),
            );
            body
        }

        /// Read one SET_ACTIVITY command, acknowledge it, and return the
        /// activity it carried.
        pub(crate) fn accept_activity(&mut self) -> Value {
            let (opcode, body) = self.read();
            assert_eq!(opcode, OP_FRAME);
            assert_eq!(body["cmd"], "SET_ACTIVITY");
            self.write(
                OP_FRAME,
                &json!({ "cmd": "SET_ACTIVITY", "evt": null, "nonce": body["nonce"], "data": {} }),
            );
            body["args"]["activity"].clone()
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use serde_json::json;

    use super::test_support::FakeDiscord;
    use super::*;

    fn connected() -> (Connection, FakeDiscord) {
        let (pipe, mut discord) = FakeDiscord::pair();
        let server = std::thread::spawn(move || {
            discord.accept();
            discord
        });
        let connection = Connection::handshake(pipe, "123").unwrap();
        (connection, server.join().unwrap())
    }

    #[test]
    fn handshake_sends_the_application_id_and_waits_for_ready() {
        let (pipe, mut discord) = FakeDiscord::pair();
        let server = std::thread::spawn(move || discord.accept());
        Connection::handshake(pipe, "123").unwrap();
        assert_eq!(
            server.join().unwrap(),
            json!({ "v": 1, "client_id": "123" })
        );
    }

    #[test]
    fn handshake_fails_when_discord_refuses_the_application() {
        let (pipe, mut discord) = FakeDiscord::pair();
        let server = std::thread::spawn(move || {
            discord.read();
            discord.write(
                OP_CLOSE,
                &json!({ "code": 4000, "message": "Invalid Client ID" }),
            );
        });
        let error = Connection::handshake(pipe, "nope").err().unwrap();
        assert!(error.to_string().contains("Invalid Client ID"), "{error}");
        server.join().unwrap();
    }

    #[test]
    fn clearing_sends_a_null_activity_and_reads_the_reply() {
        let (mut connection, mut discord) = connected();
        let server = std::thread::spawn(move || {
            let (_, body) = discord.read();
            assert_eq!(body["args"]["pid"], std::process::id());
            assert!(body["args"]["activity"].is_null());
            // An unrelated event first: the reply is matched by nonce.
            discord.write(OP_FRAME, &json!({ "cmd": "DISPATCH", "evt": "OTHER" }));
            discord.write(
                OP_FRAME,
                &json!({ "cmd": "SET_ACTIVITY", "evt": "ERROR", "nonce": body["nonce"],
                         "data": { "code": 4000, "message": "bad activity" } }),
            );
        });
        assert_eq!(
            connection.set_activity(None).unwrap().as_deref(),
            Some("bad activity")
        );
        server.join().unwrap();
    }

    #[test]
    fn idle_drain_answers_pings_and_notices_discord_quitting() {
        let (mut connection, mut discord) = connected();
        connection.drain().unwrap();

        discord.write(OP_PING, &json!({ "n": 7 }));
        // The ping may land after a 1 ms drain; retry until it is answered.
        let server = std::thread::spawn(move || {
            let reply = discord.read();
            drop(discord);
            reply
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut result = Ok(());
        while result.is_ok() && Instant::now() < deadline {
            result = connection.drain();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(server.join().unwrap(), (OP_PONG, json!({ "n": 7 })));
        assert!(result.is_err(), "a closed socket ends the connection");
    }
}
