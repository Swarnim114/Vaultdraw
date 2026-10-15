use crate::history::names::*;

const ULID: &str = "01JKXYZ0123456789ABCDEFGHJ";
const KEY: &str = "01JKXYZ0123456789ABCDEFGHK";

#[test]
fn version_names_round_trip() {
    for name in [
        format!("{ULID}-0abcdefg.ka.vdh").replace('g', "h"),
        format!("{ULID}-0abcdefh.kc.vdh"),
        format!("{ULID}-0abcdefh.dl{KEY}.vdh"),
        format!("{ULID}-0abcdefh.pm.vdh"),
        format!("{ULID}-zzzzzzzz.kq.vdh"), // unknown reason letter stays valid
    ] {
        let v = VersionName::parse(&name).unwrap_or_else(|| panic!("{name}"));
        assert_eq!(v.format(), name);
    }
    let v = VersionName::parse(&format!("{ULID}-0abcdefh.dr{KEY}.vdh")).unwrap();
    assert_eq!(v.reason(), Reason::BeforeRestore);
    assert!(!v.is_keyframe());
    assert_eq!(v.kind, NameKind::Delta(Reason::BeforeRestore, KEY.into()));
    assert!(VersionName::parse(&format!("{ULID}-0abcdefh.kq.vdh")).unwrap().reason() == Reason::Unknown('q'));
    assert_eq!(VersionName::parse(&format!("{ULID}-0abcdefh.pm.vdh")).unwrap().reason(), Reason::Moved);
}

#[test]
fn version_names_reject_bad_input() {
    let good = format!("{ULID}-0abcdefh.ka.vdh");
    assert!(VersionName::parse(&good).is_some());
    let bad = [
        good.replace("0abcdefh", "0ABCDEFH"), // upper-case dev
        good.replace("0abcdefh", "0abcdefi"), // I in dev
        good.replacen('0', "I", 1),           // I in ULID
        good.replacen('0', "L", 1),
        good.replacen('0', "O", 1),
        good.replacen('0', "U", 1),
        good.replacen("01J", "01j", 1), // lower-case ULID
        format!("{good}.vdh"),
        good.replace(".ka.vdh", ".ka..vdh"),
        good.replace(".ka.", ".kA."),
        good.replace(".ka.", ".k."),
        good.replace(".ka.", ".kaa."),
        good.replace(".ka.", ".d1."),
        good.replace(".ka.", ".da."),
        good.replace(".ka.", &format!(".da{}.", &KEY[..25])),
        good.replace(".ka.", &format!(".da{KEY}x.")),
        good.replace(".ka.", &format!(".da{}.", KEY.replace('K', "I"))),
        good.replace(".ka.", ".pm2."),
        good.replace(".vdh", ".vdh.tmp"),
        format!(".{good}.tmp"),
        format!("../{good}"),
        format!("a/{good}"),
        format!("{good}/"),
        good.replace('-', "/"),
        good.replace("-0abcdefh", "_0abcdefh"),
        "nul\0".to_string(),
        "".to_string(),
        ".vdh".to_string(),
        "é".repeat(30) + ".vdh",
        good.replace("01JKX", "01JK\u{e9}"),
    ];
    for b in bad {
        assert!(VersionName::parse(&b).is_none(), "{b:?} must be rejected");
    }
}

#[test]
fn blob_names() {
    let sha = "a".repeat(64);
    let name = format!("{sha}-0abcdefh-0abc.png");
    let b = BlobName::parse(&name).unwrap();
    assert_eq!((b.shard(), b.sha_ext().as_str(), b.format().as_str()), ("aa", format!("{sha}.png").as_str(), name.as_str()));
    for bad in [
        format!("{}-0abcdefh-0abc.png", "A".repeat(64)),
        format!("{}-0abcdefh-0abc.png", "a".repeat(63)),
        format!("{sha}-0ABCDEFH-0abc.png"),
        format!("{sha}-0abcdefh-0ABC.png"),
        format!("{sha}-0abcdefh-0abc.PNG"),
        format!("{sha}-0abcdefh-0abc."),
        format!("{sha}-0abcdefh-0abc.toolongext"),
        format!("{sha}-0abcdefh-0abc.p/g"),
        format!("{sha}-0abcdefh-0abc.png.png"),
        format!("{sha}-0abcdefh-0abi.png"),
        format!("../{sha}-0abcdefh-0abc.png"),
        format!("{sha}.png"),
        format!("{sha}-0abcdefh.png"),
    ] {
        assert!(BlobName::parse(&bad).is_none(), "{bad}");
    }
    assert!(is_sha_ext(&format!("{sha}.png")) && is_sha_ext(&format!("{sha}.jpeg123")));
    assert!(!is_sha_ext(&format!("{sha}.")) && !is_sha_ext(&sha) && !is_sha_ext(&format!("{sha}.ab/c")) && !is_sha_ext("é"));
}

#[test]
fn validators() {
    assert!(is_ulid(ULID) && !is_ulid(&ULID.to_lowercase()) && !is_ulid(&ULID[1..]) && !is_ulid(&format!("{ULID}0")));
    assert!(is_device("0abcdefh") && !is_device("0abcdefu") && !is_device("0abcdef") && !is_device("0abcdefhh"));
    assert!(is_epoch("0abc") && !is_epoch("0abl") && !is_epoch("0ab") && !is_epoch("0ABC"));
    assert!(!is_ulid("é0000000000000000000000000") && !is_device("éééé") );
}

#[test]
fn reasons() {
    for c in "alcorxfvem".chars() {
        assert_eq!(Reason::from_code(c).code(), c);
        assert_eq!(Reason::from_str(Reason::from_code(c).as_str()), Reason::from_code(c));
    }
    assert_eq!(Reason::from_code('z'), Reason::Unknown('z'));
    assert_eq!(Reason::from_code('z').code(), 'z');
    assert_eq!(Reason::from_str("whatever"), Reason::Unknown('?'));
    assert_eq!(Reason::Unknown('z').as_str(), "unknown");
    for (c, full) in [('a', false), ('l', false), ('v', false), ('x', false), ('c', true), ('r', true), ('o', true), ('f', true), ('e', true)] {
        assert_eq!(Reason::from_code(c).needs_full_sync(), full, "{c}");
    }
}

#[test]
fn ulid_generation_time_and_monotonic() {
    let mut g = UlidGen::load(None);
    let t = 1_739_539_200_000u64;
    let a = g.next(t);
    assert!(is_ulid(&a));
    assert_eq!(ulid_time_ms(&a), Some(t));
    // clock steps back: ids keep increasing and sort after the earlier one
    let b = g.next(t - 5_000);
    let c = g.next(t - 5_000);
    assert_eq!(ulid_time_ms(&b), Some(t + 1));
    assert_eq!(ulid_time_ms(&c), Some(t + 2));
    assert!(a < b && b < c, "lexicographic order follows time");
    // same instant twice
    let d = g.next(t + 10);
    let e = g.next(t + 10);
    assert!(d < e);
    // far apart ids sort by time
    assert!(g.next(t + 1_000_000) > e);
    // randomness differs between ids at distinct times and the random part is not constant
    let rnd: std::collections::HashSet<String> = (0..50).map(|_| g.next(t + 2_000_000)[10..].to_string()).collect();
    assert!(rnd.len() > 40);
    assert_eq!(ulid_time_ms("ZZZZZZZZZZZZZZZZZZZZZZZZZZ"), None, "overflowing time");
    assert_eq!(ulid_time_ms("short"), None);
    assert_eq!(VersionName::parse(&format!("{a}-0abcdefh.ka.vdh")).unwrap().time_ms(), t);
}

#[test]
fn ulid_last_is_persisted_best_effort() {
    let dir = tempfile::tempdir().unwrap();
    let mut g = UlidGen::load(Some(dir.path()));
    let t = 1_739_539_200_000u64;
    g.next(t);
    drop(g);
    let mut g2 = UlidGen::load(Some(dir.path()));
    assert_eq!(ulid_time_ms(&g2.next(t - 60_000)), Some(t + 1));
    // corrupt file = start from 0; missing dir is fine
    std::fs::write(dir.path().join("ulid-last"), "garbage").unwrap();
    assert_eq!(ulid_time_ms(&UlidGen::load(Some(dir.path())).next(7)), Some(7));
    let mut g3 = UlidGen::load(Some(&dir.path().join("does/not/exist")));
    assert!(is_ulid(&g3.next(1)));
}

#[test]
fn device_id_follows_the_host() {
    let dir = tempfile::tempdir().unwrap();
    let a = load_or_create_device(dir.path()).unwrap();
    assert!(is_device(&a));
    assert_eq!(load_or_create_device(dir.path()).unwrap(), a);
    // restored backup from another Mac: uuid mismatch -> new id
    let text = std::fs::read_to_string(dir.path().join("device")).unwrap();
    std::fs::write(dir.path().join("device"), text.replace(' ', " 00 ")).unwrap();
    let b = load_or_create_device(dir.path()).unwrap();
    assert!(is_device(&b) && b != a);
    std::fs::write(dir.path().join("device"), "garbage").unwrap();
    assert!(is_device(&load_or_create_device(dir.path()).unwrap()));
    // missing state dir gets created
    let nested = dir.path().join("x/y");
    assert!(is_device(&load_or_create_device(&nested).unwrap()));
}

#[test]
fn epochs() {
    // 2020-01-01T00:00:00Z
    assert_eq!(day_number(1_577_836_800_000), 0);
    assert_eq!(day_number(1_577_836_800_000 + 86_399_999), 0);
    assert_eq!(day_number(1_577_836_800_000 + 86_400_000), 1);
    assert_eq!(day_number(0), 0, "before 2020 saturates");
    assert_eq!(epoch_code(0), "0000");
    assert_eq!(epoch_code(31), "000z");
    assert_eq!(epoch_code(32), "0010");
    for d in [0, 1, 2000, 100_000, (1 << 20) - 1, 1 << 20, u32::MAX] {
        assert!(is_epoch(&epoch_code(d)), "{d}");
    }
    assert!(is_device(&random_crockford_lower(8)));
    assert_eq!(random_crockford_lower(5).len(), 5);
}
