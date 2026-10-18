# 沧海出行 · canghai-transit-web

从现有 canghai-web 源码拆出的独立网页版，保留同一个 Rapid Bus Socket.IO / Engine.IO 3 实时接入协议、角色图片、天气、汇率和隐藏作者彩蛋。原网页未被替换。

## 当前功能

- 官方完整线路目录：本次下载包含 137 条 rapid-bus-kl 类别线路；目录与线路几何按需加载。
- 线路搜索、逐条勾选、常用四线、全网看车、车辆实时地图和 GPS 时间。
- 查询节奏：少量线路约每 5 秒一轮，全网每条请求间隔至少 350 毫秒，一轮约 48 秒。
- “实时”以每辆车 GPS 时间为准；无数据、断线及定位过期不伪装成停运。
- 单次“我的位置”，仅点击后申请权限，显示精度圈，不上传到项目服务器。
- 马大附近天气、令吉兑人民币换算、页尾作者小彩蛋。

## 官方覆盖实测

同一实时接口：wss://rapidbus-socketio-avl.prasarana.com.my/socket.io/?EIO=3&transport=websocket

请求：42 + ["onFts-reload", {"sid":"","uid":"","provider":"RKL","route":"线路编号"}]

返回 onFts-client，base64 解码并解压 gzip/deflate 后解析车辆。完整报告见 LIVE-PROBE.json。本次只做单次有节奏的覆盖验证，没有反复扫描上游。

本次 142 个请求含 137 条 Rapid KL 类别线路和 5 条接驳巴士样本，收到 142 帧；131 个线路编号返回 447 条原始车辆记录。该数量是本次观测，包含可能过期的 GPS；页面仍需按 GPS 时间过滤。没有收到车辆不能据此认定线路不支持或停运。

91 条 MRT feeder 静态线路另有官方目录，但其 route_id 是另一套编号；本次 5 个样本未在当前 RKL Socket 方案下返回车辆。尚未对接该数据源，界面不会把这 91 条冒充已支持实时定位。轻轨和其他运营商暂不在当前完成范围内。

## 验证与限制

node --test test/*.test.mjs

测试涉及完整目录与几何文件一致性、全网节奏、过期数据清理、非原四线路解码，以及停止后异步旧消息隔离。未完成真实浏览器新页面的端到端与定位权限验证，尚未发布。

公交站点匹配使用线路几何，下一站仅为位置估计，未对全部线路完成 dir 与 GTFS 方向编号的逐条校准，不提供全网精确到站倒计时。全网轮询仍由浏览器直连上游；面向较多用户前应评估共享缓存与上游承载，避免每位用户重复扫描全网。

## 部署

使用 .github/workflows/pages.yml。每次构建获取官方 GTFS Static，重新生成 site/network。GitHub Pages 应选择 Actions 作为发布源。需要 HTTPS 才能使用浏览器定位（本地 localhost 例外）。

独立仓库：yuchenkan39-maker/canghai-transit-web。完整实时覆盖验证另保存在原私有仓库分支 codex/transit-network-probe。

