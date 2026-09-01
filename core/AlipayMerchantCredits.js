/**
 * 签到代码模板
 */

// 配置信息
let { config } = require('../config.js')(runtime, global)
// 单例require 必须引用
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
// 悬浮窗组件 按需引用
let FloatyInstance = singletonRequire('FloatyUtil')
// 找控件专用 按需引用
let widgetUtils = singletonRequire('WidgetUtils')
// 自动执行专用 如点击等 按需引用
let automator = singletonRequire('Automator')
// 大部分的公共方法 按需引用
let commonFunctions = singletonRequire('CommonFunction')
// 本地OCR工具 按需引用
let localOcrUtil = require('../lib/LocalOcrUtil.js')
// 日志打印 按需引用
let logUtils = singletonRequire('LogUtils')
let WarningFloaty = singletonRequire('WarningFloaty')

let BaseSignRunner = require('./BaseSignRunner.js')
function SignRunner () {
  BaseSignRunner.call(this)
  const DAILY_SIGNED = 'alimerchaint_DAILY_SIGNED'
  this.initStorages = function () {
    // 是否执行过签到
    this.signedStore = this.createStoreOperator(DAILY_SIGNED, { executed: false, count: 0 })
  }

  let _package_name = 'com.eg.android.AlipayGphone'
  /**
   *  扩展exec代码 实现具体的签到逻辑
   */
  this.exec = function () {
    // 记录本轮已执行过的任务标题，防止"去浏览/去完成"任务完成后按钮未刷新导致的死循环
    this.executedTaskTitles = new Set()
    // ...
    // 在这里写签到执行的代码
    // ...
    if (this.openCreditsPage()) {
      this.checkAndSign()
    } else {
      FloatyInstance.setFloatyText('进入签到页面失败')
      sleep(1000)
    }
    // 执行成功后触发 标记当前任务已完成 失败了请勿调用
    // this.setExecuted()
    commonFunctions.minimize()
  }

  /**
   * 打开积分签到页面
   */
  /**
   * 关闭"添加商家服务到首页"弹窗（首页可能出现，干扰一键领取按钮）
   */
  this.closeMerchantServicePopup = function () {
    let popupText = widgetUtils.widgetGetOne('添加「商家服务」到首页|不错过每日签到领积分', 1500)
    if (popupText) {
      this.pushLog('检测到添加商家服务弹窗，尝试关闭')
      let closeBtn = widgetUtils.widgetGetOne('×|\u2715|关闭', 1000)
      if (closeBtn) {
        this.displayButtonAndClick(closeBtn, '关闭弹窗')
        sleep(1000)
      } else {
        // 点击弹窗左上角关闭区域或返回
        automator.back()
        sleep(1000)
      }
      FloatyInstance.setFloatyText('已关闭添加商家服务弹窗')
    }
  }

  /**
   * 点击"一键领取"按钮并处理结果（首页今日收款区域下方）
   */
  this.collectQuickCredits = function () {
    // 多次尝试 widget 查找并点击"一键领取"
    let quickClaim = null
    for (let i = 0; i < 3 && !quickClaim; i++) {
      quickClaim = widgetUtils.widgetGetOne('一键领取', 1500)
      if (!quickClaim) {
        sleep(500)
      }
    }
    if (!quickClaim) {
      // widget 找不到（Compose/图片按钮）→ 用 OCR 截图兜底查找并点击
      this.pushLog('widget未找到一键领取，尝试OCR查找')
      let ocrBtn = this.captureAndCheckByOcr('一键领取', { content: '一键领取', delay: 800, clickIt: true, loop: 3 })
      if (ocrBtn) {
        this.pushLog('OCR找到一键领取按钮，已点击')
        sleep(1500)
        quickClaim = ocrBtn
      } else {
        this.pushLog('OCR也未找到一键领取按钮，可能今日已领取')
        return
      }
    } else {
      this.pushLog('找到一键领取按钮，点击领取')
      this.displayButtonAndClick(quickClaim, '一键领取')
      sleep(1500)
    }
    // 处理可能弹出的领取成功/提示对话框
    let closeBtn = widgetUtils.widgetGetOne('完成|知道了|确定|关闭|好的', 1000)
    if (closeBtn) {
      this.displayButtonAndClick(closeBtn, '关闭领取提示')
      sleep(800)
    }
    // 若进入新页面，返回
    if (!widgetUtils.widgetCheck('商家积分|一键领取|每日签到', 1000)) {
      automator.back()
      sleep(1000)
    }
  }

  this.openCreditsPage = function () {
    commonFunctions.launchPackage(_package_name)
    sleep(500)
    if (config.is_alipay_locked) {
      alipayUnlocker.unlockAlipay()
      sleep(500)
    }

    app.startActivity({
      action: 'VIEW',
      data: 'alipays://platformapi/startapp?appId=60000081',
      packageName: _package_name
    })
    FloatyInstance.setFloatyText('查找 商家积分 控件')
    sleep(1500)
    // 关闭可能的"添加商家服务到首页"弹窗
    this.closeMerchantServicePopup()
    let creditEntry = widgetUtils.widgetGetOne('商家积分')
    if (this.displayButtonAndClick(creditEntry, '商家积分')) {
      this.pushLog('检查是否有可领取积分')
      // 点击"一键领取"（处理弹窗 + 领取结果）
      this.collectQuickCredits()
      creditEntry = widgetUtils.widgetGetOne('每日签到')
      if (this.displayButtonAndClick(creditEntry, '每日签到')) {
        return true
      }
    }

    return false
  }

  this.checkDailySign = function () {
    let signed = this.captureAndCheckByOcr('已领取')
    if (this.displayButton(signed, '已领取')) {
      this.setExecuted()
    } else {
      FloatyInstance.setFloatyText('未找到已领取按钮')
    }

  }

  /**
   * 执行签到
   */
  this.checkAndSign = function () {
    FloatyInstance.setFloatyText('查找今日签到控件')
    let signEntry = this.captureAndCheckByOcr('今日签到领.*')
    if (this.displayButton(signEntry, '今日签到')) {
      let clickPoint = { x: signEntry.bounds().left, y: signEntry.bounds().bottom + signEntry.bounds().height() }
      logUtils.debugInfo(['点击位置：{}', JSON.stringify(clickPoint)])
      automator.click(clickPoint.x, clickPoint.y)
      sleep(1000)
      this.checkDailySign()
      WarningFloaty.clearAll()
      this.doTask()
    } else {
      FloatyInstance.setFloatyText('未找到签到入口，可能今天已经完成签到')
      this.checkDailySign()
      this.findEntranceAndDoTask()
      // TODO 校验是否真实的完成了签到
      // this.setExecuted()
    }
    sleep(500)
  }

  this.findEntranceAndDoTask = function () {
    this.doTask()
    this.pushLog('任务执行完毕，准备检查是否有可领取的积分')
    this.openCreditsPage()
  }

  this.doTask = function (tryTime) {
    tryTime = tryTime || 1
    if (tryTime >= 12) {
      logUtils.errorInfo(['执行超过十二次，估计死循环了 并没有那么多任务可以执行'])
      return
    }
    sleep(3000)
    // 1. 优先领取已完成任务产生的"领积分"奖励（无需浏览）
    let collectBtns = widgetUtils.widgetGetAll('领积分', 3000)
    if (collectBtns && collectBtns.length > 0) {
      this.pushLog('发现' + collectBtns.length + '个领积分按钮 逐个点击领取')
      for (let i = 0; i < collectBtns.length; i++) {
        let btn = collectBtns[i]
        let info = collectMerchantTaskInfo(btn)
        if (info.points !== null && info.points > 10) {
          this.pushLog('跳过超过+10积分的领积分按钮：' + info.title + ' +' + info.points + '积分')
          continue
        }
        this.pushLog('点击领积分：' + (info.title || '未知任务') + (info.points ? ' +' + info.points + '积分' : ''))
        let target = this.ensureTargetInVisible(btn, [0, config.device_height * 0.2, config.device_width, config.device_height * 0.8],
          () => widgetUtils.widgetGetOne('领积分', 2000))
        if (this.displayButtonAndClick(target, '领积分')) {
          sleep(1500)
        }
      }
    }
    // 2. 处理剩余"去浏览/去完成"任务
    let targetButtons = widgetUtils.widgetGetAll('去浏览|去完成', 3000)
    let task = getFirstTaskInfo.call(this, targetButtons, this.executedTaskTitles)
    if (task) {
      this.executedTaskTitles.add(task.taskInfo.title)
      task.execute.call(this)
      sleep(1000)
      if (!widgetUtils.widgetGetOne('赚更多积分', 2000)) {
        // 重新打开签到页面
        this.openCreditsPage()
      }
      this.doTask(tryTime - 1)
    }
  }

  /**
   * 从"去浏览/去完成"按钮向上收集任务信息（标题+积分）
   * 关键：用按钮的 y 坐标约束收集范围——只取与按钮同一行(y重叠/接近)的文本，
   * 即使向上爬到列表容器也不会串到其他任务行。
   * 积分解析：优先取 <=10 的小积分；若无小积分取第一个大积分（交由上层>10过滤跳过）。
   */
  function collectMerchantTaskInfo (btnWidget) {
    // 判断文本是否为签到日历/无关标题
    function isCalendarText (txt) {
      if (txt.indexOf('已连签') > -1) return true
      if (txt.indexOf('签到') > -1) return true
      if (txt.indexOf('规则') > -1) return true
      if (txt.indexOf('今天') > -1) return true
      if (txt.indexOf('第') > -1 && txt.indexOf('天') > -1) return true
      if (txt.indexOf('已领取') > -1) return true
      return false
    }
    // 判断文本是否为有效任务标题
    function isValidTitle (txt) {
      if (txt == '去完成' || txt == '去浏览' || txt == '领积分' || txt == '领取' || txt == '完成' || txt == '浏览' || txt == '领') return false
      if (txt.indexOf('积分') > -1) return false
      if (isCalendarText(txt)) return false
      // 排除纯数字/序号
      if (/^\d+$/.test(txt.trim())) return false
      return true
    }
    // 收集容器内所有含文本的节点（text + bounds），用于按位置过滤
    function collectTextNodes (widget, depth, out) {
      if (!widget || depth > 8) return
      try {
        let t = widget.text()
        if (t && t.toString().trim().length > 0) {
          let b = null
          try { b = widget.bounds() } catch (e) {}
          out.push({ text: t.toString(), bounds: b })
        }
      } catch (e) {}
      let cc = 0
      try { cc = widget.childCount() } catch (e) { return }
      for (let i = 0; i < cc; i++) {
        let child = null
        try { child = widget.child(i) } catch (e) { continue }
        if (child) collectTextNodes(child, depth + 1, out)
      }
    }
    // 判断一个容器子树内（限深度）是否包含"去浏览/去完成"按钮文本
    function containsButtonText (widget, depth) {
      if (!widget || depth > 5) return false
      try {
        let t = widget.text()
        if (t) {
          let s = t.toString()
          if (s == '去浏览' || s == '去完成' || s == '领积分') return true
        }
      } catch (e) {}
      let cc = 0
      try { cc = widget.childCount() } catch (e) { return false }
      for (let i = 0; i < cc; i++) {
        let child = null
        try { child = widget.child(i) } catch (e) { continue }
        if (child && containsButtonText(child, depth + 1)) return true
      }
      return false
    }

    // 获取按钮自身 y 中心
    let btnCenterY = 0
    try {
      let bb = btnWidget.bounds()
      if (bb) btnCenterY = (bb.top + bb.bottom) / 2
    } catch (e) {}

    // ===== 从按钮向上爬，找含按钮文本的容器，用 y 约束取同行文本 =====
    let container = btnWidget
    for (let level = 0; level < 5; level++) {
      try {
        container = container.parent()
        if (!container) break
      } catch (e) { break }
      if (!containsButtonText(container, 0)) continue
      // 收集容器内所有文本节点
      let nodes = []
      try { collectTextNodes(container, 0, nodes) } catch (e) {}
      // 用按钮 y 中心过滤：取与按钮同一行的文本（y 中心距离 < 220）
      let rowNodes = nodes.filter(n => {
        if (!n.bounds) return false
        let c = (n.bounds.top + n.bounds.bottom) / 2
        return Math.abs(c - btnCenterY) < 220
      })
      // 从同行文本解析标题（含按钮文本，需排除）
      let title = null
      for (let i = 0; i < rowNodes.length; i++) {
        if (isValidTitle(rowNodes[i].text)) {
          title = rowNodes[i].text
          break
        }
      }
      // 解析积分：优先<=10，否则取第一个大积分
      let points = null
      let firstBig = null
      for (let i = 0; i < rowNodes.length; i++) {
        let pm = rowNodes[i].text.match(/\+(\d+)积分/)
        if (pm) {
          let p = parseInt(pm[1])
          if (p <= 10) {
            points = p
            break
          }
          if (!firstBig) firstBig = p
        }
      }
      if (!points) points = firstBig
      if (title) {
        return { title: title, points: points }
      }
    }
    // 兜底：找不到标题
    logUtils.warnInfo('无法读取当前任务标题，使用默认标题兜底')
    return { title: '未知任务', points: null }
  }

  function getFirstTaskInfo (btnList, excludeTitles) {
    if (!btnList || btnList.length < 0) {
      return null
    }
    excludeTitles = excludeTitles || new Set()
    // 健壮解析任务信息，并过滤超过10积分的任务
    let taskInfos = []
    btnList.forEach(btn => {
      let info = collectMerchantTaskInfo(btn)
      if (info.points !== null && info.points > 10) {
        logUtils.debugInfo(['跳过超过+10积分任务：标题={} 积分={}', info.title, info.points])
        return
      }
      if (excludeTitles.has(info.title)) {
        logUtils.debugInfo(['跳过已执行过的任务：标题={}', info.title])
        return
      }
      taskInfos.push({ title: info.title, points: info.points, btn: btn })
    })
    const taskDefine = [
      // 商品橱窗 滑动15秒
      () => buildTask((taskInfo) => /商品橱窗/.test(taskInfo.title), function () {
        let startY = config.device_height - config.device_height * 0.15
        let endY = startY - config.device_height * 0.3
        let limit = 16
        this.replaceLastLog('等待任务完成16s')
        while (limit-- > 0 && !widgetUtils.widgetGetOne('任务已完成', 1000)) {
          automator.gestureDown(startY, endY)
          this.replaceLastLog('等待任务完成' + limit + 's')
        }
        automator.back()
      }),
      // 视频任务 直接等待 设置静音
      () => buildTask((taskInfo) => /视频/.test(taskInfo.title), function () {
        let currentVolume = device.getMusicVolume()
        device.setMusicVolume(0)
        let limit = 32
        this.pushLog('等待' + limit + 's')
        while (limit-- > 0) {
          this.replaceLastLog('等待' + limit + 's')
          sleep(1000)
        }
        this.pushLog('等待3秒 确保完成')
        sleep(3000)
        device.setMusicVolume(currentVolume)
        automator.back()
      }),
      // 需要滑动等待的任务
      () => buildTask((taskInfo) => /逛0元下单好物|红包会场/.test(taskInfo.title),
        function () {
          let startY = config.device_height - config.device_height * 0.15
          let endY = startY - config.device_height * 0.3
          let limit = 35
          this.pushLog('等待任务完成'+limit+'s')
          while (limit-- > 0 && (widgetUtils.widgetGetOne('浏览.*秒|逛一逛.*', 3000) || limit > 5)) {
            automator.gestureDown(startY, endY)
            this.replaceLastLog('等待任务完成' + limit + 's')
          }
          automator.back()
        }
      ),
      // 进入并等待即可的任务
      () => buildTask((taskInfo) => /游戏中心|逛运动走路线|借呗|逛信用卡|红包集卡抽|芝麻攒粒攻略|逛一逛领优惠|网商贷|逛一逛租赁专场|飞猪旅行/.test(taskInfo.title),
        function () {
          let limit = 35
          this.pushLog('等待任务完成'+limit+'s')
          while (limit-- > 0 && (widgetUtils.widgetGetOne('浏览.*秒|逛一逛.*', 3000) || limit > 5)) {
            this.replaceLastLog('等待任务完成' + limit + 's')
            sleep(1000)
          }
          automator.back()
        }
      ),
      // 通用兜底任务：所有<=10积分的任务都执行（点击进入 滑动浏览 返回）
      // 注意：executor 内不能引用 taskInfo（未定义），标题由外层 execute 打印
      () => buildTask((taskInfo) => true, function () {
        let startY = config.device_height - config.device_height * 0.15
        let endY = startY - config.device_height * 0.3
        let limit = 16
        while (limit-- > 0) {
          this.replaceLastLog('浏览等待' + limit + 's')
          automator.gestureDown(startY, endY)
          sleep(1000)
        }
        automator.back()
        sleep(1000)
      }),
    ]
    for (let i = 0; i < taskDefine.length; i++) {
      let taskExecutor = taskDefine[i]()
      if (taskExecutor)
        return {
          taskInfo: taskExecutor.taskInfo,
          execute: function () {
            let taskInfo = taskExecutor.taskInfo
            this.pushLog('执行任务：' + taskInfo.title + (taskInfo.points ? ' +' + taskInfo.points + '积分' : ''))
            // 按钮在可见范围内直接点击；若在屏幕外，滚动到可见后重新按标题匹配按钮（避免点错其他任务）
            let target = this.ensureTargetInVisible(taskInfo.btn, [0, config.device_height * 0.2, config.device_width, config.device_height * 0.8],
              () => {
                let allBtns = widgetUtils.widgetGetAll('去浏览|去完成', 2000)
                if (!allBtns) return null
                for (let b of allBtns) {
                  let info = collectMerchantTaskInfo(b)
                  if (info.title === taskInfo.title) return b
                }
                return null
              })
            if (this.displayButtonAndClick(target, '去完成')) {
              sleep(1000)
              taskExecutor.executor.call(this)
            }
          }
        }
    }

    this.pushLog('当前任务列表均未定义：' + JSON.stringify(taskInfos.map(taskInfo => taskInfo.title)))

    return null
    function buildTask (filter, executor) {
      let results = taskInfos.filter(taskInfo => filter(taskInfo))
      if (results.length > 0) {
        return {
          taskInfo: results[0],
          executor: executor,
        }
      }
      return null
    }
  }

}

SignRunner.prototype = Object.create(BaseSignRunner.prototype)
SignRunner.prototype.constructor = SignRunner
module.exports = new SignRunner()
