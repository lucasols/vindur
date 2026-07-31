pub(crate) fn murmur2(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut hash = 0_u32;
    let mut index = 0usize;

    while index + 4 <= bytes.len() {
        let mut chunk = u32::from(bytes[index])
            | (u32::from(bytes[index + 1]) << 8)
            | (u32::from(bytes[index + 2]) << 16)
            | (u32::from(bytes[index + 3]) << 24);
        chunk = chunk.wrapping_mul(0x5bd1_e995);
        chunk ^= chunk >> 24;
        chunk = chunk.wrapping_mul(0x5bd1_e995);
        hash = hash.wrapping_mul(0x5bd1_e995) ^ chunk;
        index += 4;
    }

    match bytes.len() - index {
        3 => {
            hash ^= u32::from(bytes[index + 2]) << 16;
            hash ^= u32::from(bytes[index + 1]) << 8;
            hash ^= u32::from(bytes[index]);
            hash = hash.wrapping_mul(0x5bd1_e995);
        }
        2 => {
            hash ^= u32::from(bytes[index + 1]) << 8;
            hash ^= u32::from(bytes[index]);
            hash = hash.wrapping_mul(0x5bd1_e995);
        }
        1 => {
            hash ^= u32::from(bytes[index]);
            hash = hash.wrapping_mul(0x5bd1_e995);
        }
        _ => {}
    }

    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0x5bd1_e995);
    hash ^= hash >> 15;
    to_base36(hash)
}

fn to_base36(mut value: u32) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }

    let mut reversed = [0_u8; 7];
    let mut length = 0usize;
    while value > 0 {
        reversed[length] = DIGITS[(value % 36) as usize];
        length += 1;
        value /= 36;
    }

    let mut output = String::with_capacity(length);
    for byte in reversed[..length].iter().rev() {
        output.push(char::from(*byte));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::murmur2;

    #[test]
    fn matches_vindur_javascript_hashes() {
        assert_eq!(murmur2("/test.tsx"), "1560qbr");
    }
}
