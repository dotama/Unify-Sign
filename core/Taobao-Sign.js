let { config } = require('../config.js')(runtime, this)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let commonFunctions = singletonRequire('CommonFunction')
let widgetUtils = singletonRequire('WidgetUtils')
let automator = singletonRequire('Automator')
let FloatyInstance = singletonRequire('FloatyUtil')
let logUtils = singletonRequire('LogUtils')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let signFailedUtil = singletonRequire('SignFailedUtil')
let logFloaty = singletonRequire('LogFloaty')

let BaseSignRunner = require('./BaseSignRunner.js')
function SignRunner () {
  const _this = this
  const _package_name = 'com.taobao.taobao'
  const storageHelper = new SignStorageHelper(this)
  this.initStorages = function () {
    storageHelper.initStorages()
  }

  BaseSignRunner.call(this)
  this.countdownLimitCounter = 0
  this.finishThisLoop = false
  this.browseAdCount = 0
  this.created_schedule = false
  this.startTime = null
  this.reopenTime = 0

  // 启动淘宝后确认回到首页或签到页，否则多次back（淘宝可能停留在上次的商品详情页）
  this.backToTaobaoHome = function () {
    for (let i = 0; i < 3; i++) {
      // 签到页特征：赚元宝/立即签到/点击领取/我的心愿
      let inSignPage = widgetUtils.widgetCheck('赚元宝|立即签到|点击领取|我的心愿', 1000)
      // 首页特征：顶部频道 tab（推荐/关注/闪购）或搜索按钮；首页 feed 首屏不一定有「红包签到」入口
      let inHomePage = widgetUtils.widgetCheck('推荐|关注|闪购|搜索', 1000)
      if (inSignPage) {
        this.pushLog('已在淘宝签到页')
        return true
      }
      if (inHomePage) {
        this.pushLog('已在淘宝首页')
        return true
      }
      this.pushLog('不在淘宝首页/签到页，back返回（第' + (i + 1) + '次）')
      automator.back()
      sleep(1500)
    }
    this.pushLog('多次back后仍未回到首页，继续尝试')
    return false
  }

  this.launchTaobao = function () {
    app.launch(_package_name)
    this.backToTaobaoHome()
    sleep(500)
    FloatyInstance.setFloatyText('校验是否有打开确认弹框')
    let confirm = widgetUtils.widgetGetOne(/^打开|允许$/, 3000)
    if (confirm) {
      this.displayButtonAndClick(confirm, '找到了打开按钮')
    } else {
      FloatyInstance.setFloatyText('没有打开确认弹框')
    }
    logFloaty.pushLog('检查是否有关闭按钮')
    let closeButton = widgetUtils.widgetGetOne('关闭按钮|关闭|^×$|^X$', 3000)
    if (closeButton) {
      this.displayButtonAndClick(closeButton, '找到了关闭按钮')
    } else {
      logFloaty.pushLog('未找到关闭按钮')
      FloatyInstance.setFloatyText('没有关闭确认弹框')
    }
    this.processGastureIfNeed()
  }

  this.closeFirstOpenDialog = function () {
    // 首次打开红包签到页会弹出「现金立即到账」领取弹窗，遮挡「立即签到」按钮，需先领取或关闭
    let dialog = widgetUtils.widgetGetOne('现金立即到账', 1500)
    if (!dialog) {
      return
    }
    this.pushLog('检测到首次打开现金弹窗，尝试领取或关闭')
    // 优先点击「领」按钮领取现金奖励
    let claim = widgetUtils.widgetGetOne('^\u9886$', 1000)
    if (claim) {
      this.displayButtonAndClick(claim, '点击领')
      sleep(1500)
      return
    }
    // 无「领」按钮则点击「×」或「关闭」关闭弹窗
    let close = widgetUtils.widgetGetOne('^\u00d7$|^X$|^关闭$|关闭', 1000)
    if (close) {
      this.displayButtonAndClick(close, '点击关闭弹窗')
      sleep(1000)
    }
  }
  /**
   * 回到淘宝首页最顶端：金刚区入口（红包签到/领淘金币/芭芭农场）可见即视为在顶部；
   * 首页停在 feed 中段时金刚区被滚走，需先上滑回顶，否则找不到「红包签到」入口。
   */
  this.scrollHomeToTop = function () {
    if (widgetUtils.widgetCheck('红包签到|领淘金币|芭芭农场', 1000)) {
      this.pushLog('首页已在最顶端，金刚区入口可见')
      return
    }
    this.pushLog('首页不在顶端，上滑回到顶部')
    for (let i = 0; i < 4; i++) {
      automator.gestureUp(config.device_height * 0.3, config.device_height * 0.75, 300)
      sleep(800)
      if (widgetUtils.widgetCheck('红包签到|领淘金币|芭芭农场', 1000)) {
        this.pushLog('已滚动回首页顶端')
        return
      }
    }
    this.pushLog('回顶后仍未看到金刚区入口')
  }

  this.openSignPage = function () {
    if (new Date().getTime() - this.startTime > 1000 * 10 * 60) {
      this.pushErrorLog('运行超时，需要退出当前签到')
      return false
    }
    // 先检查是否已经在签到页（淘宝冷启动可能恢复到上次的签到页）
    let inSignPage = widgetUtils.widgetGetOne('赚元宝|立即签到|点击领取|我的心愿', 2000)
    if (inSignPage) {
      this.pushLog('已在签到页面，无需重新进入')
      return true
    }
    this.processGastureIfNeed()
    this.scrollHomeToTop()
    let signBtn = this.displayButtonAndClick(widgetUtils.widgetGetOne('红包签到'), '找到了签到按钮')
    if (!signBtn) {
      this.processGastureIfNeed()
      if (this.captureAndCheckByOcr('我的淘宝', '我的淘宝', [config.device_width / 2, config.device_height * 0.8, config.device_width / 2, config.device_height * 0.2], 1000, true, 3)) {
        signBtn = this.displayButtonAndClick(widgetUtils.widgetGetOne('签到领现金'), '找到了签领现金按钮')
      }
    }
    if (signBtn) {
      if (widgetUtils.widgetCheck('我的心愿', 3000)) {
        this.pushLog('当前是淘宝活动界面，再次寻找入口')
        signBtn = this.displayButtonAndClick(widgetUtils.widgetGetOne('红包签到'), '找到了红包签到按钮')
      }
    }
    return !!signBtn
  }

  this.checkAndCollect = function () {
    if (this.openSignPage()) {
      widgetUtils.widgetWaiting('赚元宝', null, 2000)
      // 记录赚元宝按钮坐标（页面刷新后控件可能找不到，用坐标兜底点击）
      let _zyb = widgetUtils.widgetGetOne('赚元宝', 2000)
      if (!_zyb) {
        // 找不到时尝试向上滚动（赚元宝可能在页面下方）
        swipe(config.device_width / 2, config.device_height * 0.7, config.device_width / 2, config.device_height * 0.3, 500)
        sleep(1000)
        _zyb = widgetUtils.widgetGetOne('赚元宝', 2000)
      }
      if (_zyb) {
        let _b = _zyb.bounds()
        this.zhuanYuanBaoPoint = { x: _b.centerX(), y: _b.centerY() }
        this.pushLog('记录赚元宝坐标：' + this.zhuanYuanBaoPoint.x + ',' + this.zhuanYuanBaoPoint.y)
      } else {
        // 控件和滚动后都找不到，用默认坐标（屏幕宽1/7、高0.37，从历史截图验证约147,883）
        this.zhuanYuanBaoPoint = { x: Math.floor(config.device_width / 7), y: Math.floor(config.device_height * 0.37) }
        this.pushLog('赚元宝控件找不到，使用默认坐标：' + this.zhuanYuanBaoPoint.x + ',' + this.zhuanYuanBaoPoint.y)
      }
      sleep(1000)
      this.processGastureIfNeed()
      this.closeFirstOpenDialog()
      this.checkDailySign()
      this.checkCountdownBtn(true)
      this.browseAds()
      if (this.signed) {
        this.setExecuted()
      } else {
        // 可能有问题 直接杀死淘宝
        commonFunctions.killCurrentApp()
      }
      // 签到是成功了，但是未主动设置定时任务，估计有问题
      let todayAllDone = this.collectFinished === true && this.zybTasksDone === true
      if (todayAllDone) {
        this.pushLog('点击领取今日已领完且赚元宝无可做任务，今日淘宝签到全部结束，不再创建定时任务')
      } else if (!this.created_schedule) {
        if (!storageHelper.checkIsCountdownExecuted()) {
          logUtils.warnInfo(['今日未创建过定时任务，直接设置五分钟后的执行计划'])
          this.createNextSchedule(this.taskCode, new Date().getTime() + 300000)
        } else if (this.has_countdown_widget) {
          logUtils.warnInfo(['有倒计时控件，但是未能正确识别倒计时时间，直接设置5分钟后的执行计划'])
          this.createNextSchedule(this.taskCode, new Date().getTime() + 300000)
        }
      }
    } else {
      logUtils.warnInfo(['未能打开签到界面'])
    }
  }

  this.checkDailySign = function () {
    if (commonFunctions.checkIsTaobaoSigned()) {
      FloatyInstance.setFloatyText('今日已完成签到')
      this.signed = true
      return
    }
    sleep(1000)
    this.processGastureIfNeed()
    // 优先控件查找「立即签到」按钮（界面文字识别比OCR更可靠，同屏「赚元宝」即为控件匹配）
    let signBtn = widgetUtils.widgetGetOne('立即签到', 3000)
    if (signBtn) {
      this.pushLog('找到立即签到按钮，点击签到')
      this.displayButtonAndClick(signBtn, '点击立即签到')
      sleep(1500)
      this.signed = true
      commonFunctions.setTaobaoSigned()
      FloatyInstance.setFloatyText('已完成立即签到')
      return
    }
    this.pushLog('控件未找到立即签到，回退到OCR识别')

    let screen = commonFunctions.captureScreen()
    if (screen && localOcrUtil.enabled) {
      let find = localOcrUtil.recognizeWithBounds(screen, null, '.*立即签到.*')
      if (find && find.length > 0) {
        let bounds = find[0].bounds
        FloatyInstance.setFloatyInfo(this.boundsToPosition(bounds), '立即签到')
        sleep(1000)
        automator.click(bounds.centerX(), bounds.centerY())
        sleep(1000)
        find = widgetUtils.widgetGetOne('.*继续领(现金|钱).*')
        if (find) {
          FloatyInstance.setFloatyInfo(this.boundsToPosition(find.bounds()), '继续领现金')
          this.signed = true
          // 找到了继续领现金才能确保确实已签到
          commonFunctions.setTaobaoSigned()
        }
      } else {
        FloatyInstance.setFloatyText('未找到立即签到，查找继续领现金')
        sleep(1000)
        find = widgetUtils.widgetGetOne('.*继续领(现金|钱).*')
        if (find) {
          FloatyInstance.setFloatyInfo(this.boundsToPosition(find.bounds()), '继续领现金')
          this.signed = true
          // 找到了继续领现金才能确保确实已签到
          commonFunctions.setTaobaoSigned()
        } else {
          if (commonFunctions.checkTaobaoFailedCount() > 3) {
            FloatyInstance.setFloatyText('查找继续领现金失败多次，标记为签到成功')
            logUtils.warnInfo(['寻找 继续领现金 失败多次，直接标记为成功，请确认是否已经正常签到'], true)
            this.signed = true
          } else {
            FloatyInstance.setFloatyText('未找到继续领现金，签到失败')
            commonFunctions.increaseTbFailedCount()
            signFailedUtil.recordFailedScreen(screen, this.taskCode, '签到')
          }
          sleep(1000)
        }
      }
    } else {
      logUtils.warnInfo(['获取截图失败或不支持OCR 暂未实现 相应签到逻辑'])
    }
  }

  /**
   * 
   * @param {string} targetText 目标文本
   * @param {Array} b 目标区域，bounds信息，left,top,right,bottom
   * @returns 
   */
  function findByWidgetOrOcr (targetText, b) {
    let region = null
    if (b && b.length == 4) {
      region = [b[0], b[1], b[2] - b[0], b[3] - b[1]]
    }
    let find = widgetUtils.widgetGetOne(targetText, 3000, null, null, (() => { if (b) { return m => m.boundsInside(b[0], b[1], b[2], b[3]) } else { return null } })())
    if (find) {
      return find
    }
    let screen = commonFunctions.captureScreen()
    if (screen && localOcrUtil.enabled) {
      find = localOcrUtil.recognizeWithBounds(screen, region, targetText)
      if (find && find.length > 0) {
        return { bounds: () => find[0].bounds, target: find[0], content: find[0].label }
      }
    }
    return null
  }

  this.checkCountdownBtn = function (waitForNext) {
    // 机制：点击「点击领取」后按钮变为倒计时(00:00:00格式)，
    // 读取按钮上的倒计时秒数，直接加入下次定时任务，不阻塞主循环。
    FloatyInstance.setFloatyText('查找是否存在 click collect')
    // 右侧「点击领取」按钮区域（右半屏上部到中部）
    let collectRegion = [config.device_width / 2, config.device_height * 0.08, config.device_width, config.device_height * 0.65]
    let awardCountdown = findByWidgetOrOcr('点击.*取', collectRegion)
    if (awardCountdown) {
      this.pushLog('找到点击领取，点击领取')
      this.displayButton(awardCountdown, '可以领')
      automator.clickCenter(awardCountdown)
      sleep(2000)
      // 点击后检测广告弹窗
      if (this.closeDialogIfPossible()) {
        this.pushLog('点击领取后弹出广告页，已处理')
      }
      // 读取按钮上的倒计时(00:00:00)，加入下次定时任务
      let seconds = this.readCollectCountdown(collectRegion)
      if (seconds && seconds > 0) {
        this.pushLog('点击领取后倒计时：' + seconds + '秒，创建定时任务稍后再来')
        this.createNextSchedule(this.taskCode, new Date().getTime() + (seconds + 5) * 1000)
        this.created_schedule = true
        storageHelper.incrCountdown(true)
        return
      }
      // 读不到倒计时：兜底创建5分钟后定时任务
      this.pushLog('未读到点击领取倒计时，兜底创建5分钟后定时任务')
      this.createNextSchedule(this.taskCode, new Date().getTime() + 305 * 1000)
      this.created_schedule = true
      storageHelper.incrCountdown(true)
      return
    } else {
      // 没找到点击领取，可能按钮正处于倒计时
      let seconds = this.readCollectCountdown(collectRegion)
      if (seconds && seconds > 0) {
        this.has_countdown_widget = true
        this.pushLog('按钮正在倒计时：' + seconds + '秒，创建定时任务稍后再来')
        this.createNextSchedule(this.taskCode, new Date().getTime() + (seconds + 5) * 1000)
        this.created_schedule = true
        storageHelper.incrCountdown(true)
        return
      }
      this.has_countdown_widget = false
      let finishedBtn = widgetUtils.widgetGetOne('.*(明日再来|明天再来|今日已领完|已领完).*', 1500)
      this.collectFinished = !!finishedBtn
      this.pushLog(finishedBtn ? '点击领取今日已领完（明日再来/已领完）' : '未找到点击领取与倒计时，可能今日已领完')
    }
  }

  this.readCollectCountdown = function (region) {
    let screen = commonFunctions.checkCaptureScreenPermission()
    if (!screen || !localOcrUtil.enabled) {
      return null
    }
    // region 是 [x1, y1, x2, y2]，转成 recognizeWithBounds 需要的 [x, y, width, height]
    let ocrRegion = region
    if (region && region.length == 4) {
      ocrRegion = [region[0], region[1], region[2] - region[0], region[3] - region[1]]
    }
    let contents = localOcrUtil.recognizeWithBounds(screen, ocrRegion, /^\D*((\d{1,2}:){1,2}\d{1,2})\D*$/)
    if (contents && contents.length > 0) {
      let label = contents.label || ''
      let m = /^\D*((\d{1,2}:){1,2}\d{1,2})\D*$/.exec(label)
      if (m) {
        let parts = m[1].split(':').map(x => parseInt(x, 10))
        if (parts.length == 2) {
          return parts[0] * 60 + parts[1]
        }
        if (parts.length == 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2]
        }
      }
    }
    return null
  }

  // 通用浏览任务：找到任务标题 → 点击 → 等待指定秒数 → 返回（跨APP则切回淘宝）
  this.doBrowseTask = function (titleRegex, waitSeconds, desc, memo) {
    return this.wrapLoopTask(memo, desc, () => {
      let target = widgetUtils.widgetGetOne(titleRegex, 3000)
      if (target) {
        this.displayButtonAndClick(target, desc)
        sleep(waitSeconds * 1000)
        // 先尝试返回
        automator.back()
        sleep(1000)
        // 检查是否回到了淘宝，如果没有（可能跳转到了支付宝等其他APP），直接切回淘宝
        let currentPkg = currentPackage()
        if (currentPkg !== _package_name) {
          this.pushLog(desc + ' 任务跳转至其他APP(' + currentPkg + ')，切回淘宝')
          app.launch(_package_name)
          sleep(2000)
        }
        return true
      }
      return false
    }, 'browse_' + desc)
  }

  // 访问签到赚元宝：去淘宝首页 → 点红包签到 → 返回任务面板
  this.doVisitSignTask = function (memo) {
    return this.wrapLoopTask(memo, '访问签到赚元宝', () => {
      let target = widgetUtils.widgetGetOne('访问签到赚元宝', 3000)
      if (target) {
        this.displayButtonAndClick(target, '访问签到赚元宝')
        sleep(2000)
        commonFunctions.minimize()
        this.launchTaobao()
        if (this.openSignPage()) {
          sleep(2000)
          automator.back()
          sleep(1000)
          return true
        }
        return false
      }
      return false
    }, 'visit_sign')
  }

  // 一键分享赚元宝：点击分享 → 关闭分享面板
  this.doShareTask = function (memo) {
    return this.wrapLoopTask(memo, '一键分享赚元宝', () => {
      let target = widgetUtils.widgetGetOne('一键分享赚元宝', 3000)
      if (target) {
        this.displayButtonAndClick(target, '一键分享赚元宝')
        sleep(2000)
        let closeBtn = widgetUtils.widgetGetOne('取消|关闭|^×$|^X$', 2000)
        if (closeBtn) {
          this.displayButtonAndClick(closeBtn, '关闭分享面板')
        } else {
          automator.back()
        }
        sleep(1000)
        return true
      }
      return false
    }, 'share_task')
  }

  // 今日累计奖励领取：完成任务数达标后点「立即领取」
  this.collectDailyReward = function () {
    let rewardBtn = widgetUtils.widgetGetOne('.*立即领取.*', 2000)
    if (rewardBtn) {
      this.displayButtonAndClick(rewardBtn, '今日累计奖励立即领取')
      sleep(1000)
      return true
    }
    return false
  }

  // ========== 通用任务执行器（基于真实控件树：任务行 View[-30,..,1111]CLICK，动作为其内TextView） ==========

  // 找当前屏幕可见的任务行：text/desc含「去」的动作TextView -> 向上找第一个clickable任务行
  // 关键：任务行bounds左右略超屏幕(-30~1111)，用“中心点是否在屏内”判断可见性
  this.findActionButtons = function () {
    let result = []
    let screenW = (typeof config !== "undefined" && config.device_width) ? config.device_width : device.width
    let screenH = (typeof config !== "undefined" && config.device_height) ? config.device_height : device.height
    try {
      let candidates = []
      try { candidates = candidates.concat(textContains('去').find()) } catch (e) {}
      try { candidates = candidates.concat(descContains('去').find()) } catch (e) {}
      let seen = {}
      for (let i = 0; i < candidates.length; i++) {
        let c = candidates[i]
        let t = (c.text() || c.desc() || '').trim()
        if (!/^去[一-龥a-zA-Z]{1,7}$/.test(t)) continue
        // 向上找第一个可点击父控件（即任务行）
        let row = c, depth = 0
        while (row && !row.clickable() && depth < 6) { row = row.parent(); depth++ }
        if (!row || !row.clickable()) continue
        let b = row.bounds()
        let cx = Math.round((b.left + b.right) / 2)
        let cy = Math.round((b.top + b.bottom) / 2)
        // 中心点必须在屏幕内（任务行左右允许略超出）
        if (cx < 0 || cx > screenW || cy < 0 || cy > screenH) continue
        let key = cx + '_' + cy
        if (seen[key]) continue
        seen[key] = true
        result.push({ row: row, action: t, cx: cx, cy: cy })
      }
      // 按从上到下排序
      result.sort(function (a, b) { return a.cy - b.cy })
    } catch (e) { this.pushLog('findActionButtons 异常：' + e.message) }
    return result
  }

  // 拼接任务行内所有文字（过滤图片资源名）
  // 递归收集任务行内所有文字（用 childCount/child，与控件树导出同通道；find(/.*/)在本机取不到）
  this.getTaskRowText = function (row) {
    let texts = []
    function walk(n) {
      if (!n) return
      try {
        let t = n.text() || n.desc()
        if (t) {
          t = t.trim()
          if (t && !/\.(jpg|jpeg|png|webp|gif)/i.test(t)) texts.push(t)
        }
      } catch (e) {}
      let cc = 0
      try { cc = n.childCount() } catch (e) { cc = 0 }
      for (let k = 0; k < cc; k++) {
        try { walk(n.child(k)) } catch (e) {}
      }
    }
    try { walk(row) } catch (e) {}
    return texts.join(' ')
  }

  // 解析任务：标题/进度(cur,total)/动作/是否已完成
  this.parseTaskInfo = function (rowText) {
    let info = { title: '', cur: -1, total: -1, action: '', done: false }
    let pm = /(.+?)\((\d+)\/(\d+)\)/.exec(rowText)
    if (pm) {
      info.title = pm[1].trim()
      info.cur = parseInt(pm[2], 10)
      info.total = parseInt(pm[3], 10)
    } else {
      info.title = rowText.replace(/(去完成|去浏览|去逛逛|去搜索|去分享|去观看|去签到|去农场|去领取|去提现|去邀请|去下单|已完成).*$/, '').trim().substring(0, 16)
    }
    let am = /(去完成|去浏览|去逛逛|去搜索|去分享|去观看|去签到|去农场|去领取|去提现|去邀请|去下单)/.exec(rowText)
    if (am) info.action = am[1]
    if (/已完成/.test(rowText)) info.done = true
    return info
  }

  // 判断是否跳过任务（返回原因字符串，null表示可做）
  this.shouldSkipTask = function (rowText, action) {
    if (action === '去邀请' || action === '去下单') return '动作' + action
    if (/邀请/.test(rowText)) return '邀请类'
    if (/发评价|带图评价|评价得/.test(rowText)) return '评价类'
    if (/下单后最高得|下单最高得/.test(rowText)) return '需真实下单'
    let gameTitleM = /(.+?)\(\d+\/\d+\)/.exec(rowText)
    let gameTitle = gameTitleM ? gameTitleM[1].trim() : ''
    if (/完成任务最高/.test(rowText) && !/^领/.test(gameTitle)) return '游戏互动类需手动完成'
    return null
  }

  // 提取浏览秒数，兼容“浏览30秒/浏览15秒/浏览15S”
  this.extractBrowseTime = function (text) {
    if (!text) return 0
    let patterns = [
      /浏览\s*(\d+)\s*[sS秒]/,
      /(\d+)\s*秒后返回/,
      /停留\s*(\d+)\s*[sS秒]/,
      /(\d+)\s*秒后领取/,
      /看\s*(\d+)\s*秒/
    ]
    for (let i = 0; i < patterns.length; i++) {
      let m = patterns[i].exec(text)
      if (m) {
        let sec = parseInt(m[1], 10)
        if (sec > 0 && sec <= 120) return sec
      }
    }
    return 0
  }

  this.detectBrowseTimeOnPage = function () {
    for (let attempt = 0; attempt < 2; attempt++) {
      let w = widgetUtils.widgetGetOne(/.*\d+\s*[sS秒].*/, 2000)
      if (w) {
        let t = w.text() || w.desc() || ''
        let sec = this.extractBrowseTime(t)
        if (sec > 0) return sec
      }
      sleep(1000)
    }
    return 15
  }

  // 浏览/任务结束后返回赚元宝任务面板
  // 「搜索得元宝」中间页：点击任意一个搜索词条进入商品页（控件优先，坐标兜底）
  this.clickSearchKeyword = function () {
    let W = config.device_width, H = config.device_height
    try {
      let titleBottom = 0
      let title = widgetUtils.widgetGetOne('.*搜索发现.*', 1000)
      if (title) titleBottom = title.bounds().bottom
      let nodes = className('android.view.View').clickable(true).find()
      let best = null
      for (let i = 0; i < nodes.length; i++) {
        let n = nodes[i]
        let b = n.bounds()
        let cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2
        let w = b.right - b.left, h = b.bottom - b.top
        if (titleBottom > 0 && cy <= titleBottom + 10) continue
        if (cy < H * 0.13 || cy > H * 0.62) continue
        if (cx > W * 0.55) continue
        if (w < 150 || h < 55 || h > 180) continue
        best = n
        break
      }
      if (best) {
        this.pushLog('点击搜索发现词条：' + JSON.stringify(best.text() || best.desc() || ''))
        this.displayButtonAndClick(best, '搜索词条')
        return true
      }
    } catch (e) { this.pushLog('查找搜索词条异常：' + e.message) }
    // 坐标兜底：搜索发现左上第一个词条（约 宽0.25、高0.165）
    this.pushLog('未定位到搜索词条控件，坐标兜底点击')
    automator.click(Math.floor(W * 0.25), Math.floor(H * 0.165))
    return true
  }

  // 跳转后浏览：搜索类任务先在「搜索得元宝」页点词条，再等待规定秒数；普通任务直接等待
  this.performTaskBrowse = function (waitSec) {
    sleep(1500)
    let searchPage = widgetUtils.widgetGetOne('.*(搜索发现|搜索得元宝|历史搜索).*', 1500)
    if (searchPage) {
      this.pushLog('检测到搜索得元宝中间页，先点击搜索词条')
      this.dumpTaskPanelLayout('layout_search.txt')
      this.clickSearchKeyword()
      sleep(3000)
    }
    // 部分任务（如逛秒杀）进入后先弹约2秒活动窗、读秒在弹窗后才开始：先关弹窗并加缓冲
    this.closeBlockingDialog()
    let realWait = waitSec + 6
    this.pushLog('浏览等待 ' + realWait + ' 秒（标注' + waitSec + '秒+缓冲6秒）...')
    sleep(realWait * 1000)
  }

  // 关闭遮挡返回的弹窗（游戏公告/活动/挽留弹窗）。仅在确认不在任务面板时调用
  this.closeBlockingDialog = function () {
    try {
      let btn = widgetUtils.widgetGetOne('.*(暂不|跳过|我知道了|知道了|残忍离开|继续退出|以后再说|暂不领取|退出小程序|关闭公告|我再想想|放弃).*', 700)
      if (btn) {
        this.displayButtonAndClick(btn, '关闭挽留弹窗')
        sleep(1000)
        return true
      }
    } catch (e) {}
    try {
      let x = widgetUtils.widgetGetOne('关闭按钮|^×$|^X$|^x$', 500)
      if (x) {
        this.displayButtonAndClick(x, '关闭弹窗叉')
        sleep(800)
        return true
      }
    } catch (e) {}
    return false
  }

  // 健壮返回任务面板：循环 back，期间关闭遮挡弹窗；外部APP直接切回；兜底强制重建
  this.returnToTaskPanel = function () {
    if (currentPackage() !== _package_name) {
      this.pushLog('当前在外部APP(' + currentPackage() + ')，切回淘宝')
      app.launch(_package_name)
      sleep(2500)
      this.reenterTaskPanel()
      return
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      if (widgetUtils.widgetGetOne('.*做任务赚元宝.*|.*今日累计奖励.*', 800)) {
        this.pushLog('已回到任务面板')
        return
      }
      this.pushLog('返回任务面板，第' + (attempt + 1) + '次back')
      automator.back()
      sleep(1800)
      if (widgetUtils.widgetGetOne('.*做任务赚元宝.*|.*今日累计奖励.*', 1200)) {
        this.pushLog('已回到任务面板')
        return
      }
      if (currentPackage() !== _package_name) {
        this.pushLog('back后到外部APP，切回淘宝重建')
        app.launch(_package_name)
        sleep(2500)
        break
      }
      // 仍在小程序/中间页，关闭遮挡弹窗（如游戏公告），为下一次back清障
      this.closeBlockingDialog()
    }
    this.pushLog('多次返回未回面板，强制重新进入签到页')
    this.reenterTaskPanel()
  }

  // 重新进入红包签到页->赚元宝任务面板
  this.reenterTaskPanel = function () {
    if (this.openSignPage()) {
      sleep(1500)
      let zyb = widgetUtils.widgetGetOne('赚元宝', 3000)
      if (zyb) {
        this.displayButtonAndClick(zyb, '赚元宝')
        sleep(1800)
      } else if (this.zhuanYuanBaoPoint) {
        automator.click(this.zhuanYuanBaoPoint.x, this.zhuanYuanBaoPoint.y)
        sleep(1800)
      }
    }
  }

  this.scrollTaskList = function () {
    try {
      this.pushLog('向上滚动任务列表')
      swipe(config.device_width / 2, config.device_height * 0.72, config.device_width / 2, config.device_height * 0.4, 500)
      sleep(1200)
      return true
    } catch (e) { return false }
  }

  // 通用任务执行主循环：进度增长则继续做同一任务直到“已完成”，连续2次无增长则放弃该任务
  this.executeGenericTasks = function () {
    let executedCount = 0
    const MAX_EXECUTE = 40
    let noActionRounds = 0
    let noDoableRounds = 0 // 连续多少屏没有任何可做任务（全是已完成/跳过）
    let taskState = {} // title -> {lastCur, stale, done, skip}
    while (executedCount < MAX_EXECUTE && noActionRounds < 8 && noDoableRounds < 3) {
      let items = this.findActionButtons()
      if (!items || items.length === 0) {
        this.scrollTaskList()
        noActionRounds++
        noDoableRounds++
        continue
      }
      let actionTaken = false
      let roundDoable = false // 本屏是否存在可执行（未完成且不跳过）的任务
      for (let i = 0; i < items.length; i++) {
        let item = items[i]
        let rowText = this.getTaskRowText(item.row)
        let info = this.parseTaskInfo(rowText)
        if (!info.action && item.action) info.action = item.action
        this.pushLog('任务行文字：' + rowText)
        let st = taskState[info.title] || (taskState[info.title] = { lastCur: null, stale: 0, done: false, skip: false })
        if (info.done) { st.done = true; continue }
        if (st.done || st.skip) continue
        let skipReason = this.shouldSkipTask(rowText, info.action)
        if (skipReason) {
          st.skip = true
          this.pushLog('跳过任务[' + info.title + ']：' + skipReason)
          continue
        }
        roundDoable = true
        // 进度未增长计数：连续2次点击后进度不变则放弃（无进度任务最多点2次）
        if (st.lastCur !== null && st.lastCur === info.cur) {
          st.stale++
          if (st.stale >= 2) {
            st.skip = true
            this.pushLog('任务[' + info.title + ']连续无进度，放弃')
            continue
          }
        } else {
          st.stale = 0
        }
        st.lastCur = info.cur
        let waitSec = this.extractBrowseTime(rowText)
        this.pushLog('执行任务[' + info.title + ']进度' + info.cur + '/' + info.total + (waitSec > 0 ? ' 浏览' + waitSec + '秒' : ' 未标时间默认15秒'))
        let pkgBefore = currentPackage()
        this.displayButtonAndClick(item.row, item.action)
        sleep(3000)
        // 验证是否跳转：包名变化 / 面板标题消失 / 出现商品页特征
        let pkgAfter = currentPackage()
        let stillPanel = widgetUtils.widgetGetOne('.*做任务赚元宝.*|.*今日累计奖励.*', 1200)
        let productPage = widgetUtils.widgetGetOne('.*(立即购买|加入购物车|宝贝详情|浏览得奖励).*', 1000)
        let jumped = (pkgAfter !== pkgBefore) || !stillPanel || productPage
        if (!jumped) {
          this.pushLog('任务[' + info.title + ']点击后未跳转，跳过')
          continue
        }
        actionTaken = true
        executedCount++
        noActionRounds = 0
        noDoableRounds = 0
        if (waitSec <= 0) waitSec = this.detectBrowseTimeOnPage()
        this.performTaskBrowse(waitSec)
        this.returnToTaskPanel()
        sleep(1500)
        this.collectDailyReward()
        break // 每次只推进一个任务，然后重新扫描
      }
      if (!actionTaken) {
        this.scrollTaskList()
        noActionRounds++
        if (roundDoable) noDoableRounds = 0
        else noDoableRounds++
      }
    }
    let allDone = noDoableRounds >= 3
    this.pushLog('通用任务执行完毕，共推进 ' + executedCount + ' 次任务，' + (allDone ? '已无可执行任务' : '仍可能有未完成任务'))
    return allDone
  }

  function ocrChecking (countdownRegion, tryTime) {
    tryTime = tryTime || 1
    let screen = commonFunctions.checkCaptureScreenPermission()
    let contents = localOcrUtil.recognizeWithBounds(screen, countdownRegion, /^\D*((\d+:){2}\d+)\D*$/)
    logUtils.debugInfo(['ocr识别文本信息：{}', JSON.stringify(contents)])
    let regex = /^\D*((\d+:){2}\d+)\D*$/
    if (contents && contents.length > 0 && regex.test(contents[0].label)) {
      let text = regex.exec(contents[0].label)[1]
      regex = /(\d+(:?))/g
      let totalNums = []
      let find = null
      while ((find = regex.exec(text)) != null) {
        totalNums.push(parseInt(find[1]))
      }
      let i = 0
      return totalNums.reverse().reduce((a, b) => { a += b * Math.pow(60, i++); return a }, 0)
    }
    if (tryTime <= 3) {
      sleep(1000)
      logUtils.warnInfo(['ocr识别失败，尝试再次识别'])
      return ocrChecking(countdownRegion, tryTime + 1)
    }
    return null
  }

  function checkEnded (countdownRegion) {
    let screen = commonFunctions.checkCaptureScreenPermission()
    let contents = localOcrUtil.recognizeWithBounds(screen, countdownRegion, /明日再来/)
    logUtils.debugInfo(['ocr识别文本信息：{}', JSON.stringify(contents)])
    if (contents && contents.length > 0) {
      return true
    }
    return false
  }

  // 导出赚元宝任务面板完整控件树到文件，用于确认真实控件结构（调试用）
  this.dumpTaskPanelLayout = function (fileName) {
    try {
      let out = []
      let nodeCount = 0
      const MAX_NODES = 4000
      function walk(node, depth) {
        if (!node || nodeCount > MAX_NODES || depth > 35) return
        nodeCount++
        let cls = node.className() || ''
        let txt = node.text() || ''
        let dsc = node.desc() || ''
        let nid = node.id() || ''
        let ck = node.clickable()
        let sc = node.scrollable()
        let b = null
        try { b = node.bounds() } catch (e) {}
        if (txt || dsc || ck || sc) {
          let line = ''
          for (let s = 0; s < depth; s++) line += '  '
          line += cls.replace('android.widget.', '')
          line += ' [' + (b ? b.left + ',' + b.top + ',' + b.right + ',' + b.bottom : 'no-bounds') + ']'
          if (ck) line += ' CLICK'
          if (sc) line += ' SCROLL'
          if (nid) line += ' id=' + nid.split('/').pop()
          if (txt) line += ' text=' + JSON.stringify(txt)
          if (dsc) line += ' desc=' + JSON.stringify(dsc)
          out.push(line)
        }
        let cc = node.childCount()
        for (let i = 0; i < cc; i++) walk(node.child(i), depth + 1)
      }
      let roots = auto.windowRoots
      if (roots && roots.length > 0) {
        for (let r = 0; r < roots.length; r++) walk(roots[r], 0)
      } else if (auto.rootInActiveWindow) {
        walk(auto.rootInActiveWindow, 0)
      }
      let dumpPath = '/sdcard/脚本/Unify-Sign/' + (fileName || 'layout_zyb.txt')
      files.write(dumpPath, out.join('\n'))
      this.pushLog('控件树已导出：' + dumpPath + ' 总节点：' + nodeCount + ' 有效行：' + out.length)
    } catch (e) {
      this.pushLog('导出控件树异常：' + e.message)
    }
  }

  this.browseAds = function (memo) {
    memo = memo || {}
    sleep(2000)
    // 等待页面稳定后再找赚元宝（签到完成后页面可能刷新，控件树短暂不可用）
    // 精确匹配赚元宝按钮（底部按钮，在继续领钱左边），不能用.*元宝.*否则会匹配到金额上方的绿色小字链接
    let entry = widgetUtils.widgetGetOne('赚元宝', 5000)
    let zybClicked = false
    if (entry) {
      zybClicked = this.displayButtonAndClick(entry, '赚元宝')
    } else if (this.zhuanYuanBaoPoint) {
      // 控件找不到但有记录的坐标，直接点击坐标（页面刷新后控件树可能不可用）
      this.pushLog('赚元宝控件找不到，使用记录坐标点击：' + this.zhuanYuanBaoPoint.x + ',' + this.zhuanYuanBaoPoint.y)
      automator.click(this.zhuanYuanBaoPoint.x, this.zhuanYuanBaoPoint.y)
      zybClicked = true
      sleep(1000)
    }
    if (zybClicked) {
      sleep(1000)
      // 先领取今日累计奖励
      this.collectDailyReward()
      // 可做的任务列表（排除购买/邀请/评价类）
      // 通用任务执行器：不依赖具体任务名称，挨个点击任务行
      // 进入任务面板后先导出一次完整控件树
      this.dumpTaskPanelLayout()
      this.zybTasksDone = this.executeGenericTasks()
      this.pushLog('赚元宝任务扫描结束，全部可做任务完成=' + this.zybTasksDone)
      this.collectDailyReward()
      // 关闭任务面板
      this.displayButtonAndClick(className('android.widget.Button').textContains('关闭').findOne(1000))
    } else {
      this.reopenTime += 1
      if (this.reopenTime > 2) {
        // 多次找不到赚元宝，放弃重开，避免死循环（签到已完成，赚元宝是可选任务）
        this.pushErrorLog('多次找不到赚元宝，放弃执行赚元宝任务')
        return
      }
      this.pushLog('无法找到赚元宝 可能界面不正常 重新打开（第' + this.reopenTime + '次）')
      commonFunctions.minimize()
      this.launchTaobao()
      if (this.openSignPage()) {
        this.closeFirstOpenDialog()
        if (!this.signed) {
          this.checkDailySign()
        }
        // 重开后等待赚元宝加载，再递归执行
        widgetUtils.widgetWaiting('赚元宝', null, 5000)
        this.browseAds(memo)
      } else {
        this.pushErrorLog('重新打开签到界面失败，退出执行')
      }
    }
  }

  this.wrapLoopTask = function (memo, desc, callback, key) {
    if (memo[key]) {
      return false
    }
    this.pushLog('查找是否存在任务：' + desc)
    if (callback()) {
      return true
    }
    memo[key] = true
    this.pushLog('未找到任务：' + desc)
    return false
  }

  this.buildCommonMemoTask = function (desc, title, key) {
    return (memo) => this.wrapLoopTask(memo, desc, () => this.buildCommonWaitingTask(title), key)
  }

  function clickTargetWithA11y (container, targetGetter) {
    if (!container) {
      return false
    }
    try {
      let target = targetGetter()
      if (target) {
        return target.click()
      } else {
        logUtils.warnInfo(['目标控件不存在'])
        return false
      }
    } catch (e) {
      logUtils.errorInfo(['提取目标控件异常' + e])
      return false
    }
  }

  this.buildCommonWaitingTask = function (title) {
    let entryTitle = widgetUtils.widgetGetOne(title, 2000)
    if (clickTargetWithA11y(entryTitle, () => entryTitle.parent().parent().child(1))) {
      let limit = 32
      while (limit-- > 0) {
        if (widgetUtils.widgetGetOne('任务完成', 1000)) {
          this.pushLog('找到了任务完成')
          break
        }
        this.replaceLastLog('等待任务完成' + (limit) + 's')
      }
      automator.back()
      return true
    }
    return false
  }

  function hangBrowse (memo) {
    return this.wrapLoopTask(memo, '去逛逛', () => {
      let hangout = widgetUtils.widgetGetOne('去逛逛')
      if (this.displayButtonAndClick(hangout, '去逛逛')) {
        sleep(1000)
        this.doBrowsing()
        this.browseAdCount++
        sleep(1000)
        automator.back()
        return true
      }
      return false
    }, 'hangDone')
  }

  function doSearch (memo) {
    return this.wrapLoopTask(memo, '去搜索', () => {
      let searchBtn = widgetUtils.widgetGetOne('去搜索')
      if (this.displayButtonAndClick(searchBtn, '去搜索')) {
        sleep(1000)
        let root = widgetUtils.widgetGetOne('搜索发现', 1000)
        if (root) {
          let firstContainer = root.parent()
          let firstTarget = widgetUtils.subWidgetGetOne(firstContainer, '.+', 2000, false, matcher => {
            return matcher.clickable().filter(node => {
              let content = node.desc() || node.text()
              return content.indexOf('搜索发现') < 0
            })
          })
          if (!this.displayButtonAndClick(firstTarget, '第一个搜索词')) {
            back()
            this.pushErrorLog('查找搜索词失败')
            if (!widgetUtils.widgetGetOne('赚元宝', 2000)) {
              back()
            }
            return false
          } else {
            logUtils.debugInfo(['控件内容：{}', firstTarget.desc() || firstTarget.text()])
          }
          logUtils.debugInfo('点击了第一个搜索词')
          if (widgetUtils.widgetGetOne('浏览本页面.*', 1000)) {
            logUtils.debugInfo(['当前控件信息检测为浏览本页面直到控件消失结束'])
            this.doBrowsing('浏览本页面.*')
          } else {
            logUtils.debugInfo(['当前控件信息检测为浏览本页面直到出现任务已完成'])
            let limit = 15
            while (!widgetUtils.widgetGetOne('.*任务已完成.*', 1000) && limit-- > 0) {
              automator.gestureDown()
              sleep(1000)
            }
          }
          logUtils.debugInfo('任务完成')
          back()
          sleep(100)
          back()
          return true
        } else {
          back()
          this.pushLog('无法找到 搜索发现 无法执行搜索任务')
          logUtils.warnInfo('未能找到 搜索发现')
          if (!widgetUtils.widgetGetOne('赚元宝', 2000)) {
            back()
          }
          return false
        }
      }
    }, 'searchDone')
  }

  function watchVideo (memo) {
    return this.wrapLoopTask(memo, '好物沉浸看', () => this.buildCommonWaitingTask('好物沉浸看.*0/1.*'), 'watchVideoAdDone')
  }

  function browseGoods (memo) {
    return this.wrapLoopTask(memo, '逛精选好物', () => {
      let entryTitle = widgetUtils.widgetGetOne('逛精选好货.*[012]/3.*', 2009)
      if (this.displayButtonAndClick(entryTitle)) {
        this.doBrowsing('滑动浏览.*')
        sleep(1000)
        automator.back()
        return true
      }
      return false
    }, 'browseGoodsDone')
  }

  function dailyMoney (memo) {
    return this.wrapLoopTask(memo, '天天领钱', () => this.buildCommonWaitingTask('去天天领钱.*0/1.*'), 'dailyMoney')
  }

  function hangSeckill (memo) {
    return this.wrapLoopTask(memo, '逛淘宝秒杀', () => this.buildCommonWaitingTask('逛淘宝秒杀.*0/1.*'), 'hangSeckill')
  }

  function orderWithdraw (memo) {
    return this.wrapLoopTask(memo, '下单立即提现', () => this.buildCommonWaitingTask('下单立即提现.*0/1.*'), 'orderWithdraw')
  }

  function hangSaveMoney (memo) {
    return this.wrapLoopTask(memo, '逛省钱包', () => this.buildCommonWaitingTask('逛省钱包.*0/1.*'), 'hangSaveMoney')
  }

  this.doSearching = function () {
    if (widgetUtils.idWaiting('com.taobao.taobao:id/dynamic_container')) {
      FloatyInstance.setFloatyText('查找搜索发现')
      let countDown = new java.util.concurrent.CountDownLatch(1)
      let searchIcon = null
      threads.start(function () {
        searchIcon = selector().className('android.view.View').boundsInside(0, 0, 0.8 * config.device_width, 0.7 * config.device_height).untilFind()
        countDown.countDown()
      })
      countDown.await(5, java.util.concurrent.TimeUnit.SECONDS)
      if (searchIcon && searchIcon.length > 1 && (searchIcon = searchIcon[1])) {
        this.displayButtonAndClick(searchIcon, '推荐商品')
        sleep(1000)
        this.doBrowsing('浏览本页面.*')
        sleep(1000)
        automator.back()
      } else {
        FloatyInstance.setFloatyText('未找到推荐商品')
        logUtils.errorInfo(['未找到推荐商品控件，自动搜索失败'])
        signFailedUtil.recordFailedScreen(commonFunctions.checkCaptureScreenPermission(), this.taskCode, '搜索任务')
        this.search_no_more = true
      }
      automator.back()
    }
    sleep(1000)
    automator.back()
  }

  this.doBrowsing = function (content, timeoutSeconds) {
    let startY = config.device_height - config.device_height * 0.15
    let endY = startY - config.device_height * 0.3
    automator.gestureDown(startY, endY)
    let start = new Date().getTime()
    let cost = null
    while ((cost = new Date().getTime() - start) < (timeoutSeconds || 16) * 1000 || widgetUtils.widgetWaiting(content || '滑动浏览', null, 5000) && cost < 40000) {
      sleep(4000)
      automator.gestureDown(startY, endY)
    }
    FloatyInstance.setFloatyText('浏览完成')
  }



  this.closeDialogIfPossible = function () {
    let toUse = widgetUtils.alternativeWidget('去使用', '立即领\\d+元宝', 3000, true)
    if (toUse.value == 1) {
      automator.clickCenter(toUse.target)
      sleep(3000)
    } else if (toUse.value == 2) {
      automator.clickCenter(toUse.target)
      sleep(1000)
      this.doBrowsing()
      automator.back()
      sleep(1000)
      this.closeDialogIfPossible()
      return true
    }
    return false
  }

  this.exec = function () {
    this.startTime = new Date().getTime()
    this.launchTaobao(_package_name)
    sleep(1000)
    this.checkAndCollect()
    sleep(1000)
    commonFunctions.minimize(_package_name)
  }

  this.processGastureIfNeed = function () {
    let tips = widgetUtils.widgetGetOne('.*完成验证.*', 1000)
    if (tips) {
      this.pushLog('存在滑动验证码')
      let slider = widgetUtils.widgetGetOne('滑块')
      if (!slider) {
        this.pushErrorLog('未能找到滑块位置')
        warnInfo(['未能找到滑块位置'], true)
        return
      }
      let start = {
        x: slider.bounds().left + 10,
        y: slider.bounds().centerY()
      }
      let end = {
        x: config.device_width - 10,
        y: slider.bounds().bottom - 10
      }
      automator.gesturePath(start, end, 1000)
      this.pushLog('手势执行完毕,等待验证结束')
      sleep(2000)
    }
  }
}

SignRunner.prototype = Object.create(BaseSignRunner.prototype)
SignRunner.prototype.constructor = SignRunner

module.exports = new SignRunner()


// ---
function SignStorageHelper (runner) {
  const HANG_WORK_DONE = "TB_HANG_WORK_DONE"
  const COUNTDOWN_CHECKING = "TB_COUNTDOWN_CHECKING"
  const COUNTDOWN_REGION = "TB_COUNTDOWN_REGION"
  this.initStorages = function () {
    // 逛一逛任务是否完成
    this.hangStore = runner.createStoreOperator(HANG_WORK_DONE, { executed: false, count: 0 })
    // 是否执行过倒计时
    this.countdownStore = runner.createStoreOperator(COUNTDOWN_CHECKING, { executed: false, count: 0 })
    // 存储倒计时识别区域
    this.countdownRegionStore = runner.createStoreOperator(COUNTDOWN_REGION, {}, true)
  }

  this.isHangTaskDone = function () {
    return this.hangStore.getValue().executed
  }

  this.incrHangTask = function () {
    this.hangStore.updateStorageValue(storeValue => storeValue.count += 1)
  }

  this.isHangTooMuch = function () {
    this.incrHangTask()
    if (this.hangStore.getValue().count >= 10) {
      logUtils.warnInfo(['逛一逛任务执行超过10次，应该是出问题了，直接跳过并设置为已完成'])
      this.setHangTaskDone()
    }
  }

  this.setHangTaskDone = function () {
    this.hangStore.updateStorageValue(storeValue => storeValue.executed = true)
  }

  /**
   * 增加倒计时的执行次数
   * @param {boolean} realExecuted 是否真实的运行过
   */
  this.incrCountdown = function (realExecuted) {
    this.countdownStore.updateStorageValue(value => {
      value.count += 1
      if (realExecuted) {
        value.executed = true
      }
    })
  }

  this.checkIsCountdownExecuted = function () {
    let executeInfo = this.countdownStore.getValue()
    logUtils.debugInfo(['当前倒计时执行次数：{}', executeInfo.count])
    // 假定倒计时设置次数，最少3次
    if (executeInfo.count >= 3) {
      return true
    }
    return false
  }

  this.getCountdownRegion = function () {
    return this.countdownRegionStore.getValue().region
  }

  this.saveCountdownRegion = function (region) {
    logUtils.debugInfo(['存储倒计时区域：{}', JSON.stringify(region)])
    this.countdownRegionStore.updateStorageValue(storageValue => storageValue.region = region)
  }

}
