//! File history (versions and checkpoints) for vault drawings.
//!
//! Design: personal/feature/file-history/PLAN.md (revision 2). One immutable `.vdh` file per
//! version inside `<vault>/.excalidraw-vault/history/`; a utility-QoS worker per writable vault
//! decides when to version; the save path only clones the committed file and sends a message.
//!
//! Owner (H1): agent B. Codec modules (`names`, `container`, `codec`) are owned by agent A.

#![allow(dead_code)]

pub(crate) mod codec;
pub(crate) mod container;
pub(crate) mod names;

#[cfg(test)]
mod tests;
