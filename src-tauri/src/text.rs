/// One Unicode scalar or a semantic Enter/Tab operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    Character(char),
    Enter,
    Tab,
}

/// Normalize Windows line endings into one send unit per logical character.
pub fn units(text: &str) -> Vec<Unit> {
    let mut result = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        result.push(match ch {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                Unit::Enter
            }
            '\n' => Unit::Enter,
            '\t' => Unit::Tab,
            ch => Unit::Character(ch),
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_unicode_spaces_and_combining_scalars() {
        assert_eq!(
            units("中 A😀e\u{301}"),
            vec![
                Unit::Character('中'),
                Unit::Character(' '),
                Unit::Character('A'),
                Unit::Character('😀'),
                Unit::Character('e'),
                Unit::Character('\u{301}')
            ]
        );
    }
    #[test]
    fn crlf_and_lf_each_become_one_enter() {
        assert_eq!(
            units("a\r\nb\n\t\r"),
            vec![
                Unit::Character('a'),
                Unit::Enter,
                Unit::Character('b'),
                Unit::Enter,
                Unit::Tab,
                Unit::Enter
            ]
        );
    }
    #[test]
    fn whitespace_remains_sendable() {
        assert_eq!(units("   ").len(), 3);
        assert!(units("").is_empty());
    }
}
