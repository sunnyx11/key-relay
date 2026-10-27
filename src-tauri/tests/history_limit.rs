use key_relay::archive::{Archive, TextAction, TextData};

#[test]
fn history_limit_defaults_to_hundred_for_missing_and_existing_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    assert_eq!(
        serde_json::to_value(TextData::load(&path).unwrap()).unwrap()["maxHistoryEntries"],
        100
    );
    std::fs::write(&path, r#"{"restoreDraft":true,"saveHistory":true,"draft":"saved","entries":[{"id":1,"time":1,"text":"first"}],"nextId":2}"#).unwrap();
    let data = TextData::load(&path).unwrap();
    assert_eq!(
        serde_json::to_value(&data).unwrap()["maxHistoryEntries"],
        100
    );
    assert_eq!(data.draft, "saved");
    assert_eq!(data.entries[0].text, "first");
}

#[test]
fn configured_capacity_above_hundred_round_trips_and_evicts_at_its_limit() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let writer = Archive::open(path.clone(), |_| {});
    writer.read().unwrap();
    writer
        .action(
            serde_json::from_value(
                serde_json::json!({"kind":"historyLimit","maxHistoryEntries":120}),
            )
            .unwrap(),
        )
        .unwrap();
    for index in 1..=121 {
        writer.record(format!("text {index}"));
    }
    let saved = writer.flush().unwrap();
    assert_eq!(saved.data.entries.len(), 120);
    assert_eq!(saved.data.entries[0].text, "text 121");
    assert!(!saved
        .data
        .entries
        .iter()
        .any(|entry| entry.text == "text 1"));
    assert_eq!(
        serde_json::to_value(&saved.data).unwrap()["maxHistoryEntries"],
        120
    );
    assert_eq!(TextData::load(&path).unwrap(), saved.data);
}

#[test]
fn lowering_capacity_preserves_pins_draft_ids_and_archive_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let mut data = TextData::default();
    data.update_draft("keep draft");
    data.record("pin", 1);
    data.entries[0].pinned = true;
    data.record("older id", 2);
    data.record("same time", 2);
    data.record("newest", 4);
    data.save(&path).unwrap();
    let writer = Archive::open(path.clone(), |_| {});
    writer.read().unwrap();
    let state = writer
        .action(
            serde_json::from_value(
                serde_json::json!({"kind":"historyLimit","maxHistoryEntries":3}),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(
        state
            .data
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        vec![4, 3, 1]
    );
    assert!(state.data.entries[2].pinned);
    assert_eq!(state.data.draft, "keep draft");
    assert_eq!(serde_json::to_value(&state.data).unwrap()["nextId"], 5);
    assert_eq!(TextData::load(&path).unwrap(), state.data);
    writer.record("next".into());
    let next = writer.flush().unwrap();
    assert_eq!(
        next.data
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>(),
        vec![5, 4, 1]
    );
}

#[test]
fn configured_full_pinned_archive_still_refreshes_latest_and_preserves_next_id() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let writer = Archive::open(path.clone(), |_| {});
    writer.read().unwrap();
    writer
        .action(
            serde_json::from_value(
                serde_json::json!({"kind":"historyLimit","maxHistoryEntries":1}),
            )
            .unwrap(),
        )
        .unwrap();
    writer.record("pin".into());
    let before = writer
        .action(TextAction::Pin {
            id: 1,
            pinned: true,
        })
        .unwrap();
    writer.record("blocked".into());
    assert_eq!(writer.flush().unwrap().data, before.data);
    writer.record("pin".into());
    let refreshed = writer.flush().unwrap();
    assert_eq!(refreshed.data.entries.len(), 1);
    assert_eq!(refreshed.data.entries[0].id, 1);
    assert!(refreshed.data.entries[0].pinned);
    assert_eq!(serde_json::to_value(refreshed.data).unwrap()["nextId"], 2);
}

#[test]
fn invalid_limits_preserve_all_preferences_and_saved_records() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let writer = Archive::open(path.clone(), |_| {});
    writer.read().unwrap();
    writer.record("first".into());
    writer.record("second".into());
    writer
        .action(TextAction::Pin {
            id: 1,
            pinned: true,
        })
        .unwrap();
    let before = writer
        .action(TextAction::Pin {
            id: 2,
            pinned: true,
        })
        .unwrap();
    for limit in [
        serde_json::json!(0),
        serde_json::json!(1),
        serde_json::json!(10001),
        serde_json::json!(-1),
        serde_json::json!(1.5),
        serde_json::Value::Null,
    ] {
        let action = serde_json::from_value::<TextAction>(
            serde_json::json!({"kind":"historyLimit","maxHistoryEntries":limit}),
        );
        assert!(action
            .map(|action| writer.action(action).is_err())
            .unwrap_or(true));
        assert_eq!(writer.read().unwrap().data, before.data);
        assert_eq!(TextData::load(&path).unwrap(), before.data);
    }
    let state = writer
        .action(
            serde_json::from_value(
                serde_json::json!({"kind":"historyLimit","maxHistoryEntries":10000}),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(state.data).unwrap()["maxHistoryEntries"],
        10000
    );
}

#[test]
fn loading_rejects_invalid_capacity_and_overfilled_files_without_modifying_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let mut data = TextData::default();
    data.record("first", 1);
    data.record("second", 2);
    for limit in [0, 1, 10001] {
        let mut json = serde_json::to_value(&data).unwrap();
        json["maxHistoryEntries"] = serde_json::json!(limit);
        let bytes = serde_json::to_vec(&json).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        assert!(TextData::load(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}
