//! Wire payloads (frozen contract, PLAN.md). Serde camelCase.

use super::extract::ItemKind;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum IndexState {
    Loading,
    Building,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexStatus {
    pub handle: String,
    pub state: IndexState,
    /// Drawings with content indexed.
    pub indexed: u32,
    /// Drawings known (walk so far).
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    All,
    Names,
    Content,
}

impl Scope {
    pub(crate) fn parse(s: Option<&str>) -> Option<Scope> {
        match s {
            None | Some("all") => Some(Scope::All),
            Some("names") => Some(Scope::Names),
            Some("content") => Some(Scope::Content),
            Some(_) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ElementMatch {
    pub element_id: String,
    pub container_id: Option<String>,
    pub kind: ItemKind,
    pub snippet: String,
    /// UTF-16 `[start, end)` into `snippet`.
    pub highlights: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchHit {
    pub path: String,
    pub name: String,
    pub score: f32,
    /// UTF-16 `[start, end)` into `name`.
    pub name_highlights: Vec<[u32; 2]>,
    pub matches: Vec<ElementMatch>,
    pub match_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResponse {
    pub query: String,
    pub results: Vec<SearchHit>,
    pub total_matches: u32,
    pub status: IndexStatus,
    pub took_ms: f64,
}
