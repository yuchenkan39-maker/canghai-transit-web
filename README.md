# 沧海出行

网页版公交地图：https://yuchenkan39-maker.github.io/canghai-transit-web/

搜索线路或地点，点击添加；已选线路点 × 移除。保留实时车辆、当前位置、按目的地方向查找附近站点、天气、汇率与作者彩蛋。已移除到站预估、路况推断、历史轨迹数据及其构建流程。

地图使用 OpenStreetMap，浅色低饱和显示；车辆与路线覆盖层保持独立颜色。实时车辆沿用 Rapid Bus Socket.IO 接入，线路与站点使用官方 GTFS Static。

验证：node --test test/*.test.mjs，共 8 项检查。推送 main 后由 GitHub Pages Actions 自动发布。
