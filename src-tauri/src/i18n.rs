//! Minimal server-side i18n.
//!
//! Rust commands return short error *codes* (`"io"`, `"not_found"`, …);
//! the frontend maps codes to localized copy through `locales/{en,es}`.
//! This module exists so Rust-side diagnostics can also be localized when
//! we need them (CLI output, crash logs — which never include manuscript text).

pub fn t(locale: &str, code: &str) -> String {
    let msg = match (locale, code) {
        ("es", "io") => "Error de archivo o disco.",
        ("es", "not_found") => "Proyecto no encontrado.",
        ("es", "project_exists") => "Ya existe un proyecto con ese nombre.",
        ("es", "empty_title") => "El título no puede estar vacío.",
        ("es", "no_home") => "No se pudo localizar la carpeta de documentos.",
        ("es", "unknown") => "Algo salió mal.",
        // MCP tool failures are read by a model, which needs to know what to do
        // next — not just that something went wrong.
        ("es", "write_not_allowed") => {
            "Este cliente es de solo lectura. El autor debe permitir la escritura en Ajustes → MCP."
        }
        ("es", "no_project") => {
            "No hay proyecto abierto. Usa open_project con la ruta de la carpeta del proyecto."
        }
        ("es", "acknowledge_required") => {
            "Borrar un capítulo requiere además acknowledge_delete: true."
        }
        ("es", "bad_args") => "Faltan argumentos o tienen el tipo equivocado.",
        ("es", "unknown_tool") => "Esa herramienta no existe.",
        ("es", "empty_message") => "El mensaje del commit está vacío.",
        ("es", "bad_range") => "Rango inválido: los desplazamientos son unidades UTF-16 del cuerpo.",
        ("es", "empty_query") => "La búsqueda está vacía.",
        _ => match code {
            "io" => "File or disk error.",
            "not_found" => "Project not found.",
            "project_exists" => "A project with that name already exists.",
            "empty_title" => "Title cannot be empty.",
            "no_home" => "Could not locate the Documents folder.",
            "write_not_allowed" => {
                "This client is read-only. The author must allow writing in Settings → MCP."
            }
            "no_project" => {
                "No project is open. Call open_project with the project folder path."
            }
            "acknowledge_required" => {
                "Deleting a chapter also requires acknowledge_delete: true."
            }
            "bad_args" => "An argument is missing or has the wrong type.",
            "unknown_tool" => "No such tool.",
            "empty_message" => "The commit message is empty.",
            "bad_range" => "Invalid range: offsets are UTF-16 code units into the body.",
            "empty_query" => "The search query is empty.",
            _ => "Something went wrong.",
        },
    };
    msg.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localizes_known_codes() {
        assert_eq!(t("es", "io"), "Error de archivo o disco.");
        assert_eq!(t("en", "io"), "File or disk error.");
        assert_eq!(t("de", "io"), "File or disk error.");
    }

    #[test]
    fn a_tool_failure_tells_the_model_what_to_do_next() {
        // A model reads these verbatim; "Something went wrong" is a dead end.
        // Every code the MCP surface can hand back to a model. Kept explicit so
        // a new tool error cannot silently degrade to "Something went wrong."
        for code in [
            "write_not_allowed",
            "no_project",
            "acknowledge_required",
            "bad_args",
            "bad_range",
            "unknown_tool",
            "empty_query",
            "empty_title",
            "empty_message",
            "not_found",
            "io",
        ] {
            for locale in ["en", "es"] {
                let message = t(locale, code);
                assert_ne!(message, "Something went wrong.", "{code} ({locale}) has no copy");
                assert_ne!(message, "Algo salió mal.", "{code} ({locale}) has no copy");
            }
        }
        assert!(t("en", "write_not_allowed").contains("Settings → MCP"));
        assert!(t("es", "acknowledge_required").contains("acknowledge_delete"));
    }
}
