//! UTF-16 ↔ byte offset conversion.
//!
//! The editor (CodeMirror) and the ops log address text in UTF-16 code units;
//! Rust slices by byte. Every AI write crosses that boundary here.

/// Byte offset for a UTF-16 code-unit index. `idx == utf16_len(s)` maps to
/// `s.len()`. Returns `None` past the end or inside a surrogate pair.
pub fn utf16_to_byte(s: &str, idx: usize) -> Option<usize> {
    let mut units = 0usize;
    for (byte, ch) in s.char_indices() {
        if units == idx {
            return Some(byte);
        }
        let width = ch.len_utf16();
        if units + width > idx {
            // idx lands between the two halves of a surrogate pair.
            return None;
        }
        units += width;
    }
    (units == idx).then_some(s.len())
}

pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_is_identity() {
        assert_eq!(utf16_len("hello"), 5);
        assert_eq!(utf16_to_byte("hello", 0), Some(0));
        assert_eq!(utf16_to_byte("hello", 3), Some(3));
        assert_eq!(utf16_to_byte("hello", 5), Some(5));
        assert_eq!(utf16_to_byte("hello", 6), None);
    }

    #[test]
    fn multibyte_bmp_chars() {
        // ñ = 2 bytes / 1 unit, — = 3 bytes / 1 unit.
        let s = "añ—b";
        assert_eq!(utf16_len(s), 4);
        assert_eq!(utf16_to_byte(s, 1), Some(1));
        assert_eq!(utf16_to_byte(s, 2), Some(3));
        assert_eq!(utf16_to_byte(s, 3), Some(6));
        assert_eq!(utf16_to_byte(s, 4), Some(7));
        assert_eq!(&s[utf16_to_byte(s, 1).unwrap()..utf16_to_byte(s, 3).unwrap()], "ñ—");
    }

    #[test]
    fn surrogate_pairs() {
        // 🌙 = 4 bytes / 2 units.
        let s = "a🌙b";
        assert_eq!(utf16_len(s), 4);
        assert_eq!(utf16_to_byte(s, 1), Some(1));
        assert_eq!(utf16_to_byte(s, 2), None);
        assert_eq!(utf16_to_byte(s, 3), Some(5));
        assert_eq!(utf16_to_byte(s, 4), Some(6));
        assert_eq!(utf16_to_byte("", 0), Some(0));
    }
}
