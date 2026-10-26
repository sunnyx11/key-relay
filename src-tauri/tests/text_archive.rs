use key_relay::{
    archive::{Archive, TextAction, TextData},
    settings::Settings,
    task::{Draft, Engine},
    windows::target::TargetInfo,
};

#[test]
fn text_archive_round_trips_draft_preferences_and_empty_clear() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let mut data = TextData::load(&path).unwrap();
    assert!(data.restore_draft && data.save_history);
    data.update_draft("a\n  中😀");
    data.record("sent", 10);
    data.save(&path).unwrap();
    assert_eq!(TextData::load(&path).unwrap(), data);
    data.update_draft("");
    data.save(&path).unwrap();
    assert_eq!(TextData::load(&path).unwrap().draft, "");
    assert_eq!(data.entries.len(), 1);
}

#[test]
fn text_archive_keeps_only_recent_hundred_and_deduplicates_only_latest() {
    let mut data = TextData::default();
    data.record("same", 1);
    data.record("same", 2);
    assert_eq!(data.entries.len(), 1);
    assert_eq!(data.entries[0].time, 2);
    for time in 3..=103 {
        data.record(&format!("text {time}"), time);
    }
    assert_eq!(data.entries.len(), 100);
    assert_eq!(data.entries[0].text, "text 103");
    assert_eq!(data.entries.last().unwrap().text, "text 4");
    data.record("text 50", 104);
    assert_eq!(data.entries.len(), 100);
    assert_eq!(
        data.entries
            .iter()
            .filter(|entry| entry.text == "text 50")
            .count(),
        2
    );
}

#[test]
fn disabling_text_saving_preserves_existing_data() {
    let mut data = TextData::default();
    data.update_draft("keep draft");
    data.record("keep history", 1);
    data.restore_draft = false;
    data.save_history = false;
    data.update_draft("private edit");
    data.record("private send", 2);
    assert_eq!(data.draft, "keep draft");
    assert_eq!(data.entries.len(), 1);
    data.entries.clear();
    assert_eq!(data.draft, "keep draft");
}

#[test]
fn malformed_text_file_is_preserved_and_errors_exclude_source() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    std::fs::write(&path, "secret malformed text").unwrap();
    let error = TextData::load(&path).unwrap_err();
    assert!(!error.contains("secret"));
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "secret malformed text"
    );
    let blocked = dir.path().join("file");
    std::fs::write(&blocked, "block directory creation").unwrap();
    assert!(TextData::default()
        .save(&blocked.join("text.json"))
        .is_err());
}

#[test]
fn writer_serializes_revisions_deletion_undo_preferences_and_flush() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let writer = Archive::open(path.clone(), |_| {});
    writer.read().unwrap();
    writer.draft(2, "latest".into());
    writer.draft(1, "stale".into());
    writer.record("first".into());
    writer.record("second".into());
    let state = writer.flush().unwrap();
    assert_eq!(state.data.draft, "latest");
    let id = state.data.entries[0].id;
    let deleted = writer.action(TextAction::Delete { id }).unwrap();
    assert!(deleted.can_undo);
    assert_eq!(deleted.data.entries[0].text, "first");
    let restored = writer.action(TextAction::Undo).unwrap();
    assert_eq!(restored.data.entries[0].text, "second");
    writer.action(TextAction::Delete { id }).unwrap();
    writer.record("third".into());
    let restored = writer.action(TextAction::Undo).unwrap();
    assert_eq!(restored.data.entries[0].text, "third");
    assert_eq!(restored.data.entries[1].text, "second");
    writer
        .action(TextAction::Preferences {
            restore_draft: false,
            save_history: false,
        })
        .unwrap();
    writer.draft(3, "private".into());
    writer.record("private send".into());
    let state = writer.flush().unwrap();
    assert_eq!(state.data.draft, "latest");
    assert_eq!(state.data.entries.len(), 3);
    assert_eq!(TextData::load(&path).unwrap(), state.data);
    writer.action(TextAction::Clear).unwrap();
    assert!(writer
        .action(TextAction::Undo)
        .unwrap()
        .data
        .entries
        .is_empty());
    writer.action(TextAction::ClearDraft).unwrap();
    assert_eq!(TextData::load(&path).unwrap().draft, "");
}

#[test]
fn flush_retries_a_failed_write_and_keeps_an_unread_file_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let writer = Archive::open(path.clone(), |_| {});
    writer.flush().unwrap();
    assert!(!path.exists());
    writer.read().unwrap();
    std::fs::create_dir(&path).unwrap();
    writer.draft(1, "recover after save failure".into());
    assert!(writer.flush().is_err());
    std::fs::remove_dir(&path).unwrap();
    writer.flush().unwrap();
    assert_eq!(
        TextData::load(&path).unwrap().draft,
        "recover after save failure"
    );
}

#[test]
fn concurrent_archive_owner_cannot_overwrite_and_can_retry_after_release() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("text.json");
    let first = Archive::open(path.clone(), |_| {});
    first.read().unwrap();
    first.draft(1, "saved by first owner".into());
    first.record("first history".into());
    first.flush().unwrap();
    let second = Archive::open(path.clone(), |_| {});
    assert!(second.read().is_err());
    second.draft(2, "second must not overwrite".into());
    second.flush().unwrap();
    assert_eq!(TextData::load(&path).unwrap().draft, "saved by first owner");
    drop(first);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        if let Ok(state) = second.read() {
            assert_eq!(state.data.draft, "saved by first owner");
            assert_eq!(state.data.entries[0].text, "first history");
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::yield_now();
    }
}

#[test]
fn history_uses_frozen_source_once_even_for_one_character_or_interruption() {
    for text in ["中", "a\r\n  b"] {
        let mut engine = Engine::new(Settings::default());
        engine.record_target(TargetInfo {
            x: 1,
            y: 1,
            title: "receiver".into(),
        });
        engine.sync(Draft {
            revision: 1,
            text: text.into(),
            settings: serde_json::to_value(Settings::default()).unwrap(),
        });
        engine.start(None, 0, 1).unwrap();
        assert!(engine.take_history_text().is_none());
        engine.sync(Draft {
            revision: 2,
            text: "later edit".into(),
            settings: serde_json::to_value(Settings::default()).unwrap(),
        });
        engine.clicked_target(0);
        assert!(engine.due(150, false, false).is_some());
        assert_eq!(engine.take_history_text().as_deref(), Some(text));
        engine.submitted(150, Ok(()));
        engine.cancel("stop");
        assert!(engine.take_history_text().is_none());
    }
}
