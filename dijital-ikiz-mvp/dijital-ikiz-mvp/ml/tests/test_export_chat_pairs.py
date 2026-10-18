from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from export_chat_pairs_for_blind_review import build_blind_review_input  # noqa: E402


def message(message_id, user_id, role, variant, content, created_at):
    return {
        "id": message_id,
        "user_id": user_id,
        "role": role,
        "variant": variant,
        "content": content,
        "created_at": created_at,
    }


def fixture_messages():
    rows = []
    for variant, response_one, response_two in (
        ("personalized", "Kişiselleştirilmiş yanıt 1", "Kişiselleştirilmiş yanıt 2"),
        ("baseline", "Genel yanıt 1", "Genel yanıt 2"),
    ):
        rows.extend([
            message(f"{variant}-u1", "raw-user-123", "user", variant, "Kısa cevap ver.", "2026-10-18T10:00:00.000Z"),
            message(f"{variant}-a1", "raw-user-123", "assistant", variant, response_one, "2026-10-18T10:00:01.000Z"),
            message(f"{variant}-u2", "raw-user-123", "user", variant, "Başka bir istem.", "2026-10-18T10:00:02.000Z"),
            message(f"{variant}-a2", "raw-user-123", "assistant", variant, response_two, "2026-10-18T10:00:03.000Z"),
        ])

    # Deliberately add an unmatched prompt to only one condition.
    rows.extend([
        message("personalized-u3", "raw-user-123", "user", "personalized", "Yalnızca bu koşulda.", "2026-10-18T10:00:04.000Z"),
        message("personalized-a3", "raw-user-123", "assistant", "personalized", "Unmatched response", "2026-10-18T10:00:05.000Z"),
    ])
    return rows


class ExportChatPairsTests(unittest.TestCase):
    def test_pairs_identical_prompts_and_pseudonymises_user_ids(self):
        rows, stats = build_blind_review_input(fixture_messages(), "s" * 48)

        self.assertEqual(stats["paired_prompts"], 2)
        self.assertEqual(stats["unmatched_personalized_prompts"], 1)
        self.assertEqual(stats["unmatched_baseline_prompts"], 0)
        self.assertEqual(stats["participants_with_pairs"], 1)
        self.assertEqual(len(rows), 4)
        self.assertNotIn("raw-user-123", str(rows))

        for pair_id in {row["pair_id"] for row in rows}:
            pair = [row for row in rows if row["pair_id"] == pair_id]
            self.assertEqual({row["variant"] for row in pair}, {"personalized", "baseline"})
            self.assertEqual(len({row["participant_id"] for row in pair}), 1)
            self.assertEqual(len({row["prompt_text"] for row in pair}), 1)

    def test_repeated_prompts_pair_by_occurrence_order(self):
        rows = [
            message("pu1", "u1", "user", "personalized", "Aynı soru", "2026-10-18T10:00:00Z"),
            message("pa1", "u1", "assistant", "personalized", "Kişiselleştirilmiş A", "2026-10-18T10:00:01Z"),
            message("pu2", "u1", "user", "personalized", "Aynı soru", "2026-10-18T10:00:02Z"),
            message("pa2", "u1", "assistant", "personalized", "Kişiselleştirilmiş B", "2026-10-18T10:00:03Z"),
            message("bu1", "u1", "user", "baseline", "Aynı soru", "2026-10-18T10:00:04Z"),
            message("ba1", "u1", "assistant", "baseline", "Genel A", "2026-10-18T10:00:05Z"),
            message("bu2", "u1", "user", "baseline", "Aynı soru", "2026-10-18T10:00:06Z"),
            message("ba2", "u1", "assistant", "baseline", "Genel B", "2026-10-18T10:00:07Z"),
        ]

        pairs, stats = build_blind_review_input(rows, "s" * 48)
        self.assertEqual(stats["paired_prompts"], 2)
        by_response = {row["response_text"]: row["pair_id"] for row in pairs}
        self.assertEqual(by_response["Kişiselleştirilmiş A"], by_response["Genel A"])
        self.assertEqual(by_response["Kişiselleştirilmiş B"], by_response["Genel B"])
        self.assertNotEqual(by_response["Kişiselleştirilmiş A"], by_response["Kişiselleştirilmiş B"])

    def test_rejects_identical_timestamps_instead_of_guessing_message_order(self):
        rows = [
            message("u", "raw-user", "user", "personalized", "soru", "2026-10-18T10:00:00Z"),
            message("a", "raw-user", "assistant", "personalized", "yanıt", "2026-10-18T10:00:00Z"),
        ]
        with self.assertRaisesRegex(ValueError, "created_at tekrar ediyor"):
            build_blind_review_input(rows, "s" * 48)

    def test_rejects_wrong_role_sequence(self):
        rows = [
            message("a", "u1", "assistant", "baseline", "yanıt", "2026-10-18T10:00:00Z"),
            message("u", "u1", "user", "baseline", "soru", "2026-10-18T10:00:01Z"),
        ]
        with self.assertRaisesRegex(ValueError, "user→assistant"):
            build_blind_review_input(rows, "s" * 48)

    def test_rejects_short_pseudonym_salt(self):
        with self.assertRaisesRegex(ValueError, "en az 32 bayt"):
            build_blind_review_input(fixture_messages(), "short")

    def test_filtering_before_a_partial_pair_fails_closed(self):
        rows = fixture_messages()
        since = datetime(2026, 10, 18, 10, 0, 0, 500000, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, "eşleşmemiş mesaj sayısı"):
            build_blind_review_input(rows, "s" * 48, since=since)


if __name__ == "__main__":
    unittest.main(verbosity=2)
