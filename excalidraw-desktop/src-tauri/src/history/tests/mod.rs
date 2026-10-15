//! Codec tests (agent A): names, container, strip/delta/inline, fuzz and the bench.
mod codec_bench;
mod codec_live;
mod codec_names;
mod codec_props;
mod fuzz_container;
mod codec_support;
mod codec_review;
#[cfg(history_codec_peak)]
mod codec_peak;
