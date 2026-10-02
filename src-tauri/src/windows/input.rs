use crate::text::Unit;
use windows::Win32::UI::Input::KeyboardAndMouse::*;

/// Private marker paired with the Windows injected flag to identify our events.
pub const INPUT_MARKER: usize = 0x4B524C59;

/// Encode one indivisible send unit, including every required key release.
pub fn encode(unit: Unit) -> Vec<INPUT> {
    let mut events = Vec::with_capacity(4);
    let (vk, codes, flags) = match unit {
        Unit::Character(ch) => (
            VIRTUAL_KEY(0),
            ch.encode_utf16(&mut [0; 2]).to_vec(),
            KEYEVENTF_UNICODE,
        ),
        Unit::Enter => (VK_RETURN, vec![0], KEYBD_EVENT_FLAGS(0)),
        Unit::Tab => (VK_TAB, vec![0], KEYBD_EVENT_FLAGS(0)),
    };
    for code in codes {
        for event_flags in [flags, flags | KEYEVENTF_KEYUP] {
            events.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: code,
                        dwFlags: event_flags,
                        time: 0,
                        dwExtraInfo: INPUT_MARKER,
                    },
                },
            });
        }
    }
    events
}

/// Submit one unit. Partial submission ends the task and releases any submitted down event.
pub fn send(unit: Unit) -> Result<(), String> {
    let events = encode(unit);
    let sent = unsafe { SendInput(&events, std::mem::size_of::<INPUT>() as i32) } as usize;
    if sent == events.len() {
        return Ok(());
    }
    if sent % 2 == 1 {
        unsafe {
            SendInput(&events[sent..sent + 1], std::mem::size_of::<INPUT>() as i32);
        }
    }
    Err("系统输入提交失败，请检查目标程序和本地权限。已提交事件可能继续处理。".into())
}

/// Check all keyboard and mouse buttons immediately before starting a task.
pub fn any_held() -> bool {
    (1..=254).any(|vk| unsafe { GetAsyncKeyState(vk) < 0 })
}

/// Detect our process's foreground window without changing the target focus.
pub fn own_foreground() -> bool {
    use windows::Win32::{
        System::Threading::GetCurrentProcessId,
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };
    unsafe {
        let foreground = GetForegroundWindow();
        let mut process = 0;
        GetWindowThreadProcessId(foreground, Some(&mut process));
        process == GetCurrentProcessId()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_has_balanced_marked_events() {
        for ch in ['a', '中', '😀'] {
            let events = encode(Unit::Character(ch));
            assert_eq!(events.len(), ch.len_utf16() * 2);
            let utf16: Vec<_> = ch.encode_utf16(&mut [0; 2]).to_vec();
            for (pair, code) in events.chunks_exact(2).zip(utf16) {
                let down = unsafe { pair[0].Anonymous.ki };
                let up = unsafe { pair[1].Anonymous.ki };
                assert_eq!(down.wScan, code);
                assert_eq!(down.wVk.0, 0);
                assert_eq!(down.dwFlags, KEYEVENTF_UNICODE);
                assert_eq!(up.dwFlags, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
                assert_eq!(up.dwExtraInfo, INPUT_MARKER);
            }
        }
    }
    #[test]
    fn enter_and_tab_are_virtual_key_pairs() {
        for (unit, vk) in [(Unit::Enter, VK_RETURN), (Unit::Tab, VK_TAB)] {
            let events = encode(unit);
            assert_eq!(events.len(), 2);
            assert_eq!(unsafe { events[0].Anonymous.ki.wVk }, vk);
            assert_eq!(unsafe { events[1].Anonymous.ki.dwFlags }, KEYEVENTF_KEYUP);
        }
    }
}
