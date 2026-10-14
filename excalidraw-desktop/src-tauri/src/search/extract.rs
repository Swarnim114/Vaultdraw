//! Drawing JSON to searchable text items. Typed serde structs: unknown fields
//! (appState, `files` image blobs, geometry) are skipped without allocation.

use super::normalize::normalize;
use crate::{err, Result};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ItemKind {
    Text,
    Frame,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TextItem {
    pub element_id: Box<str>,
    /// The shape/arrow a bound label belongs to.
    pub container_id: Option<Box<str>>,
    pub kind: ItemKind,
    /// Original (un-normalised) text.
    pub text: Box<str>,
}

#[derive(Deserialize)]
struct Scene<'a> {
    #[serde(default, borrow, rename = "type")]
    kind: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    elements: Vec<El<'a>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct El<'a> {
    #[serde(default, borrow)]
    id: Option<Cow<'a, str>>,
    #[serde(default, borrow, rename = "type")]
    ty: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    text: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    original_text: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    name: Option<Cow<'a, str>>,
    #[serde(default, borrow)]
    container_id: Option<Cow<'a, str>>,
    #[serde(default)]
    is_deleted: Option<bool>,
}

fn non_empty<'a>(s: &'a Option<Cow<'a, str>>) -> Option<&'a str> {
    s.as_deref().filter(|t| !t.trim().is_empty())
}

/// Extracts text elements (bound labels use `originalText`, which has no
/// auto-wrap newlines) and frame names. Items that normalise to nothing are dropped.
pub(crate) fn extract_items(json: &[u8]) -> Result<Vec<TextItem>> {
    let scene: Scene = serde_json::from_slice(json).map_err(|e| err("INVALID_FILE", format!("Invalid JSON: {e}")))?;
    if scene.kind.as_deref() != Some("excalidraw") {
        return Err(err("INVALID_FILE", "Not an Excalidraw scene"));
    }
    let mut out = Vec::new();
    for el in &scene.elements {
        if el.is_deleted == Some(true) {
            continue;
        }
        let (kind, text) = match el.ty.as_deref() {
            Some("text") => (ItemKind::Text, non_empty(&el.original_text).or_else(|| non_empty(&el.text))),
            Some("frame" | "magicframe") => (ItemKind::Frame, non_empty(&el.name)),
            _ => continue,
        };
        let (Some(text), Some(id)) = (text, el.id.as_deref().filter(|i| !i.is_empty())) else { continue };
        if normalize(text).is_empty() {
            continue;
        }
        out.push(TextItem {
            element_id: id.into(),
            container_id: el.container_id.as_deref().filter(|c| !c.is_empty()).map(Into::into),
            kind,
            text: text.into(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn items(json: &str) -> Vec<TextItem> {
        extract_items(json.as_bytes()).unwrap()
    }

    #[test]
    fn bound_text_prefers_original_text_and_keeps_container() {
        let v = items(
            r#"{"type":"excalidraw","elements":[
            {"id":"t1","type":"text","text":"Hello\nWorld","originalText":"Hello World","containerId":"r1"},
            {"id":"t2","type":"text","text":"Free","originalText":""},
            {"id":"r1","type":"rectangle"}]}"#,
        );
        assert_eq!(v.len(), 2);
        assert_eq!(&*v[0].text, "Hello World");
        assert_eq!(v[0].container_id.as_deref(), Some("r1"));
        assert_eq!(&*v[1].text, "Free");
        assert_eq!(v[1].container_id, None);
        assert_eq!(v[1].kind, ItemKind::Text);
    }

    #[test]
    fn frames_named_deleted_skipped_and_blank_dropped() {
        let v = items(
            r#"{"type":"excalidraw","elements":[
            {"id":"f1","type":"frame","name":"Backend"},
            {"id":"f2","type":"magicframe","name":"AI"},
            {"id":"f3","type":"frame","name":null},
            {"id":"f4","type":"frame","name":""},
            {"id":"d1","type":"text","text":"gone","isDeleted":true},
            {"id":"b1","type":"text","text":"   "}]}"#,
        );
        let got: Vec<_> = v.iter().map(|i| (&*i.element_id, i.kind)).collect();
        assert_eq!(got, vec![("f1", ItemKind::Frame), ("f2", ItemKind::Frame)]);
    }

    #[test]
    fn files_blob_and_unknown_fields_are_ignored() {
        let v = items(
            r#"{"type":"excalidraw","version":2,"appState":{"x":1},"files":{"a":{"dataURL":"data:image/png;base64,AAAA"}},
            "elements":[{"id":"t","type":"text","text":"ok","x":1.5,"points":[[0,0]]}]}"#,
        );
        assert_eq!(v.len(), 1);
    }

    #[test]
    fn rejects_non_excalidraw_json() {
        assert!(extract_items(b"{\"type\":\"other\",\"elements\":[]}").is_err());
        assert!(extract_items(b"[1,2]").is_err());
        assert!(extract_items(b"not json").is_err());
    }
}
