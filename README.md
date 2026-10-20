# 沧海出行

网页版公交地图：https://yuchenkan39-maker.github.io/canghai-transit-web/

点搜索框左边的「线路 ▾」打开线路菜单，按 全部 / 已选 / T 接驳 / PJ · 布城 / 数字干线 / 其他 分类浏览，点一下勾选或取消，可以连续选多条，点「完成」或菜单外面收起。也可以直接在搜索框输入线路名或地点（如 mid valley），回车添加第一条结果。已选线路点 × 移除。保留实时车辆、当前位置、按目的地方向查找附近站点、天气、汇率与作者彩蛋。已移除到站预估、路况推断、历史轨迹数据及其构建流程。

地图使用 OpenStreetMap 原色；路线画成带白色描边的实心粗线，T790、T786、PJ01、PJ02 固定使用主应用的蓝、绿、紫、粉，其他线路轮流使用同一套调色板。实时车辆沿用 Rapid Bus Socket.IO 接入，线路与站点使用官方 GTFS Static。

验证：先运行 `python tools/build_network.py` 生成 site/network/，再运行 `node --test test/*.test.mjs`，共 12 项检查。推送 main 后由 GitHub Pages Actions 自动构建、测试并发布。
