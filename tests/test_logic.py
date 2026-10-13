"""Offline checks for plan math and static-path containment."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import snapshot_store
from app.executor import Executor
from app.server import resolve_static


SNAP = {
    "collections": [
        {"id": 1, "title": "A", "gamesCount": 2, "games": [
            {"id": 10, "title": "G10"}, {"id": 11, "title": "G11"},
        ]},
        {"id": 2, "title": "B", "gamesCount": 1, "games": [
            {"id": 10, "title": "G10"},
        ]},
    ],
}


def titles(snap, title):
    for c in snap["collections"]:
        if c["title"] == title:
            return [g["id"] for g in c["games"]]
    return None


class PlanTests(unittest.TestCase):
    def test_add_and_remove_cancel(self):
        plan = snapshot_store.normalize_plan({
            "create": [],
            "add": [{"collection": "A", "gameId": 99}],
            "remove": [{"collection": "A", "gameId": 99}],
            "deleteCollections": [],
        })
        self.assertEqual(plan["add"], [])
        self.assertEqual(plan["remove"], [])

    def test_add_and_remove_cancel_across_a_missing_id(self):
        # One side names the collection by id, the other only by title: same
        # membership, so they must still cancel.
        plan = snapshot_store.normalize_plan({
            "create": [], "deleteCollections": [],
            "add": [{"collection": "A", "collectionId": 1, "gameId": 99}],
            "remove": [{"collection": "A", "gameId": 99}],
        })
        self.assertEqual(plan["add"], [])
        self.assertEqual(plan["remove"], [])

    def test_create_and_title_delete_cancel_including_adds(self):
        plan = snapshot_store.normalize_plan({
            "create": [{"title": "N"}],
            "add": [{"collection": "N", "gameId": 10}],
            "remove": [],
            "deleteCollections": [{"title": "N"}],
        })
        self.assertEqual(snapshot_store.plan_size(plan), 0)

    def test_recreate_same_name_keeps_adds_for_the_new_collection(self):
        plan = snapshot_store.normalize_plan({
            "create": [{"title": "A"}],
            "add": [{"collection": "A", "gameId": 11, "gameTitle": "G11"}],
            "remove": [],
            "deleteCollections": [{"title": "A", "collectionId": 1}],
        })
        self.assertEqual(len(plan["create"]), 1)
        self.assertEqual(len(plan["deleteCollections"]), 1)
        self.assertEqual(plan["add"][0]["gameId"], 11)
        preview = snapshot_store.apply_plan_to_snapshot(SNAP, plan)
        groups = [c for c in preview["collections"] if c["title"] == "A"]
        self.assertEqual(len(groups), 1)
        self.assertEqual([g["id"] for g in groups[0]["games"]], [11])
        self.assertTrue(groups[0]["id"] < 0)

    def test_apply_remove_preview_shape(self):
        plan = {
            "create": [],
            "add": [{"collection": "B", "collectionId": 2, "gameId": 11}],
            "remove": [{"collection": "A", "collectionId": 1, "gameId": 11}],
            "deleteCollections": [],
        }
        preview = snapshot_store.apply_plan_to_snapshot(SNAP, plan)
        self.assertEqual(titles(preview, "A"), [10])
        self.assertEqual(titles(preview, "B"), [10, 11])

    def test_drop_keys_keeps_unrelated_ops(self):
        plan = {
            "create": [{"title": "N"}],
            "add": [{"collection": "A", "gameId": 12}, {"collection": "B", "gameId": 13}],
            "remove": [],
            "deleteCollections": [],
        }
        keys = {snapshot_store.flatten_plan(plan)[1]["key"]}
        left = snapshot_store.drop_keys(plan, keys)
        self.assertEqual(len(left["create"]), 1)
        self.assertEqual([a["gameId"] for a in left["add"]], [13])

    def test_delete_prefers_explicit_id_over_a_same_named_create(self):
        ex = Executor()
        created = {"A": 999}
        delete_old = ex._collection_id(
            {"op": "deleteCollection", "title": "A", "collectionId": 1},
            {"A": 1}, created, prefer_explicit=True,
        )
        add_new = ex._collection_id(
            {"op": "add", "collection": "A", "gameId": 11},
            {"A": 1}, created, prefer_explicit=False,
        )
        self.assertEqual(delete_old, 1)
        self.assertEqual(add_new, 999)


class ExecStatusTests(unittest.TestCase):
    def test_status_returns_an_independent_copy(self):
        # The UI polls status() during a run; it must never be able to mutate
        # the executor's live state (or see a later edit through a stale handle).
        ex = Executor()
        ex._set(logs=["a"], summary={"ok": 1})
        st = ex.status()
        st["logs"].append("b")
        st["summary"]["ok"] = 99
        fresh = ex.status()
        self.assertEqual(fresh["logs"], ["a"])
        self.assertEqual(fresh["summary"]["ok"], 1)


class OrderTests(unittest.TestCase):
    """The `order` bucket: games inside one collection, not the collection list."""

    def test_last_order_for_a_collection_wins(self):
        plan = snapshot_store.normalize_plan({
            "create": [], "add": [], "remove": [], "deleteCollections": [],
            "order": [{"collection": "A", "collectionId": 1, "gameIds": [11, 10]},
                      {"collection": "A", "collectionId": 1, "gameIds": [10, 11]}],
        })
        self.assertEqual([o["gameIds"] for o in plan["order"]], [[10, 11]])

    def test_order_is_dropped_for_a_deleted_collection(self):
        plan = snapshot_store.normalize_plan({
            "create": [], "add": [], "remove": [],
            "order": [{"collection": "A", "collectionId": 1, "gameIds": [10, 11]}],
            "deleteCollections": [{"title": "A", "collectionId": 1}],
        })
        self.assertEqual(plan["order"], [])

    def test_order_runs_last_and_only_reorders(self):
        plan = {"create": [], "deleteCollections": [],
                "add": [{"collection": "A", "collectionId": 1, "gameId": 11}],
                "remove": [{"collection": "A", "collectionId": 1, "gameId": 10}],
                "order": [{"collection": "A", "collectionId": 1, "gameIds": [11]}]}
        # Membership first: the ids an order carries only mean something once
        # the adds and removes of the same run have landed.
        self.assertEqual([i["op"] for i in snapshot_store.flatten_plan(plan)],
                         ["add", "remove", "order"])
        preview = snapshot_store.apply_plan_to_snapshot(SNAP, plan)
        self.assertEqual(titles(preview, "A"), [11])


class GuardTests(unittest.TestCase):
    def test_static_path_cannot_escape(self):
        self.assertIsNotNone(resolve_static("app.js"))
        self.assertIsNone(resolve_static("../app/config.py"))
        self.assertIsNone(resolve_static("..\\..\\..\\windows\\win.ini"))

    def test_merge_plans_keeps_both_sides(self):
        base = {"create": [], "add": [{"collection": "A", "gameId": 1}], "remove": [], "deleteCollections": []}
        extra = {"create": [{"title": "B"}], "add": [{"collection": "B", "gameId": 2}], "remove": [], "deleteCollections": []}
        merged = snapshot_store.merge_plans(base, extra)
        self.assertEqual({a["gameId"] for a in merged["add"]}, {1, 2})
        self.assertEqual([c["title"] for c in merged["create"]], ["B"])

    def test_orphans_are_reported_once_each(self):
        # 11 lives only in A, so pulling it out leaves it in no collection at all.
        only_a = {"create": [], "add": [], "remove": [{"collection": "A", "collectionId": 1, "gameId": 11}],
                  "deleteCollections": []}
        self.assertEqual([o["id"] for o in snapshot_store.games_orphaned_by_plan(SNAP, only_a)], [11])
        # 10 sits in both A and B (the snapshot lists it twice): taking it out of
        # both orphans it, and it must still be reported exactly once.
        both = {"create": [], "add": [], "deleteCollections": [],
                "remove": [{"collection": "A", "collectionId": 1, "gameId": 10},
                           {"collection": "B", "collectionId": 2, "gameId": 10}]}
        self.assertEqual([o["id"] for o in snapshot_store.games_orphaned_by_plan(SNAP, both)], [10])
        # Leaving it in one of the two is enough to keep it visible.
        both["remove"] = both["remove"][:1]
        self.assertEqual(snapshot_store.games_orphaned_by_plan(SNAP, both), [])


if __name__ == "__main__":
    unittest.main()
