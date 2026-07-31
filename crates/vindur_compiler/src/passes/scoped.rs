use rustc_hash::FxHashMap;

pub(crate) fn declared_scoped_variable_names(css: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut cursor = 0usize;
    while let Some(relative_start) = css[cursor..].find("---") {
        let name_start = cursor + relative_start + 3;
        let name_end = scoped_name_end(css, name_start);
        if name_end > name_start && css[name_end..].trim_start().starts_with(':') {
            names.push(css[name_start..name_end].to_owned());
        }
        cursor = name_end.max(name_start);
    }
    names
}

pub(crate) fn process_scoped_variables(
    css: &str,
    file_hash: &str,
    dev: bool,
    id_index: &mut u32,
    variables: &mut FxHashMap<String, String>,
) -> String {
    let mut output = String::with_capacity(css.len());
    let mut cursor = 0usize;
    while let Some(relative_start) = css[cursor..].find("---") {
        let start = cursor + relative_start;
        output.push_str(&css[cursor..start]);
        let name_start = start + 3;
        let name_end = scoped_name_end(css, name_start);
        if name_end == name_start {
            output.push_str("---");
            cursor = name_start;
            continue;
        }
        let name = &css[name_start..name_end];
        let generated = variables.entry(name.to_owned()).or_insert_with(|| {
            let index = *id_index;
            *id_index += 1;
            if dev {
                format!("{file_hash}-{index}-{name}")
            } else {
                format!("{file_hash}-{index}")
            }
        });
        output.push_str("--");
        output.push_str(generated);
        cursor = name_end;
    }
    output.push_str(&css[cursor..]);
    output
}

fn scoped_name_end(css: &str, name_start: usize) -> usize {
    css[name_start..]
        .char_indices()
        .find_map(|(offset, character)| {
            (!character.is_ascii_alphanumeric() && character != '-').then_some(name_start + offset)
        })
        .unwrap_or(css.len())
}
