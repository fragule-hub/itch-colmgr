"""itch.io / collections demo snapshot for UI试用（无 key 演示模式）."""
import json

DEMO = {
    "syncedAt": "演示数据",
    "profile": {"id": 0, "username": "demo"},
    "demo": True,
    "collections": [
        {"id": 101, "title": "想玩的", "gamesCount": 6, "games": [
            {"id": 1, "title": "Deep Cave", "author": "wanderwork", "coverUrl": "", "url": "https://itch.io", "shortText": "手绘风的地下洞窟探索 roguelite，每层随机生成。", "classification": "game"},
            {"id": 2, "title": "Last Lighthouse", "author": "moonglass", "coverUrl": "", "url": "https://itch.io", "shortText": "守灯人在末日海面的叙事解谜，短小但后劲很大。", "classification": "game"},
            {"id": 3, "title": "Static Rooms", "author": "vhhsim", "coverUrl": "", "url": "https://itch.io", "shortText": "模拟 90 年代教室的恐怖步行模拟器。", "classification": "game"},
            {"id": 4, "title": "Orbit Farm", "author": "tildedev", "coverUrl": "", "url": "https://itch.io", "shortText": "在环绕恒星的轨道上种田的放置游戏。", "classification": "game"},
            {"id": 5, "title": "Null Signal", "author": "pixelfern", "coverUrl": "", "url": "https://itch.io", "shortText": "接收到一段无法解析的信号，侦探风格的视觉小说。", "classification": "game"},
            {"id": 6, "title": "Hollow Sun", "author": "emberowl", "coverUrl": "", "url": "https://itch.io", "shortText": "像素动作平台，难度类似蔚蓝但更暴力。", "classification": "game"},
        ]},
        {"id": 102, "title": "恐怖", "gamesCount": 3, "games": [
            {"id": 3, "title": "Static Rooms", "author": "vhhsim", "coverUrl": "", "url": "https://itch.io", "shortText": "模拟 90 年代教室的恐怖步行模拟器。", "classification": "game"},
            {"id": 7, "title": "Grave Mire", "author": "pebblepond", "coverUrl": "", "url": "https://itch.io", "shortText": "沼泽里的第一人称短篇恐怖，10 分钟流程。", "classification": "game"},
            {"id": 8, "title": "The Quiet Tenant", "author": "slowhouse", "coverUrl": "", "url": "https://itch.io", "shortText": "你合租的室友似乎不是人。心理恐怖。", "classification": "game"},
        ]},
        {"id": 103, "title": "Roguelike", "gamesCount": 2, "games": [
            {"id": 1, "title": "Deep Cave", "author": "wanderwork", "coverUrl": "", "url": "https://itch.io", "shortText": "手绘风的地下洞窟探索 roguelite，每层随机生成。", "classification": "game"},
            {"id": 9, "title": "Card Crypt", "author": "shuffled", "coverUrl": "", "url": "https://itch.io", "shortText": "卡牌构筑爬塔，肉鸽元素很重，单局 20 分钟。", "classification": "game"},
        ]},
    ],
}


def load() -> dict:
    return json.loads(json.dumps(DEMO))
