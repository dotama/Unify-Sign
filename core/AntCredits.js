/*
 * @Author: TonyJiangWJ
 * @Date: 2020-04-25 16:46:06
 * @Last Modified by: tanggq
 * @Last Modified time: 2025-05-31 20:51:46
 * @Description: 
 */

let { config } = require('../config.js')(runtime, this)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let commonFunctions = singletonRequire('CommonFunction')
let alipayUnlocker = singletonRequire('AlipayUnlocker')
let widgetUtils = singletonRequire('WidgetUtils')
let logUtils = singletonRequire('LogUtils')
let automator = singletonRequire('Automator')
let FloatyInstance = singletonRequire('FloatyUtil')
let BaseSignRunner = require('./BaseSignRunner.js')
let signFailedUtil = singletonRequire('SignFailedUtil')
let warningFloaty = singletonRequire('WarningFloaty')

function CreditRunner () {
  BaseSignRunner.call(this)
  let _package_name = 'com.eg.android.AlipayGphone'
  let _family_regex = /^\+(\d+)$/
  let _this = this
  let sign_page_widget = '我已连签|赚更多积分|立即领|再领1积分|福利任务|去完成|连续签到|可补签|会员.*签到赚积分|做任务赚积分'

  this.collectFamily = false

  this.openCreditPage = function (tryTime) {
    tryTime = tryTime || 1
    commonFunctions.launchPackage(_package_name)
    sleep(500)
    if (config.is_alipay_locked) {
      alipayUnlocker.unlockAlipay()
    }
    app.startActivity({
      action: 'VIEW',
      data: 'alipays://platformapi/startapp?appId=20000160&url=%2Fwww%2FmyPoints.html',
      packageName: _package_name
    })
    sleep(500)
    FloatyInstance.setFloatyText('校验是否有打开确认弹框')
    let confirm = widgetUtils.widgetGetOne(/^打开$/, 3000)
    if (confirm) {
      this.displayButtonAndClick(confirm, '找到了打开按钮')
    } else {
      FloatyInstance.setFloatyText('没有打开确认弹框')
    }
    if (!widgetUtils.widgetWaiting('(我的(积分|等级特权))|每日签到|我已连签|赚更多积分|立即领|再领1积分|福利任务')) {
      if (tryTime >= 5) {
        warnInfo(['检测到未能进入会员积分界面，已尝试多次，放弃重试'])
        return false
      }
      warnInfo(['检测到未能进入会员积分界面，重新进入'])
      commonFunctions.minimize()
      return this.openCreditPage(tryTime++)
    }
    return true
  }


  /**
   * 判断比例 是不是正方形
   * @param {目标控件} bounds 
   */
  this.isCollectableBall = function (bounds) {
    if (bounds) {
      let flag = Math.abs(bounds.width() - bounds.height()) <= 10 && bounds.width() > 30
      logUtils.debugInfo(['校验控件形状是否符合：[{}, {}] result: {}', bounds.width(), bounds.height(), flag])
      return flag
    }
    return false
  }

  this.canCollect = function (val) {
    let bounds = val.bounds()
    return this.isCollectableBall(bounds)
  }

  this.collectCredits = function (position, regex) {
    // 等待稳定
    sleep(1000)
    let widgets = widgetUtils.widgetGetAll(regex, null, true)
    let collected = true
    while (widgets && collected) {
      logUtils.logInfo(['总数：{}', widgets.target.length])
      let targets = widgets.target
      let isDesc = widgets.isDesc
      let totalCollect = 0
      targets.forEach(val => {
        let contentInfo = isDesc ? val.desc() : val.text()
        if (this.canCollect(val)) {
          automator.clickCenter(val)
          logUtils.logInfo([
            'value: {}', contentInfo
          ])
          totalCollect += parseInt(regex.exec(contentInfo)[1])
          sleep(500)
        }
      })
      logUtils.infoLog(['{} 总共领取：「{}」分', position, totalCollect])
      collected = totalCollect > 0
      if (collected) {
        sleep(1000)
        // 再次检测, 缩短检测超时时间为两秒
        widgets = widgetUtils.widgetGetAll(regex, 2000, true)
      }
    }
  }

  this.checkAndCollect = function () {
    sleep(1000)
    FloatyInstance.setFloatyTextColor('#00ff00')
    FloatyInstance.setFloatyText('准备打开每日签到页面')
    auto.clearCache && auto.clearCache()
    // 新界面直接打开签到页，仅当成功打开签到页面才标记当日已签到，避免界面变更时误标记已执行导致任务无法重跑
    let signOpened = openSignPage()
    if (signOpened) {
      commonFunctions.setAliCreditsSigned()
      FloatyInstance.setFloatyText('已进入每日签到页面')
    } else {
      FloatyInstance.setFloatyTextColor('#ff0000')
      FloatyInstance.setFloatyText('未能进入每日签到页面，暂不标记已签到')
      signFailedUtil.recordFailedWidgets(this.taskCode, '每日签到页面')
    }
    return signOpened
  }

  /**
   * 领取"我的积分"页面上的积分按钮（如"生活缴费 领取4积分"、"领取N积分"）
   * 在 openCreditPage 打开会员积分页后调用，循环点击所有可领取的积分按钮
   */
  this.collectPageRewards = function () {
    sleep(1000)
    let round = 0
    while (round < 5) {
      round++
      FloatyInstance.setFloatyText('检测我的积分页面的领取按钮 第' + round + '次')
      let collectBtn = widgetUtils.widgetGetOne(/领取\d+积分/, 2000)
      if (!collectBtn) {
        if (round == 1) {
          FloatyInstance.setFloatyText('未找到页面积分领取按钮')
          this.pushLog('我的积分页面无可领取积分')
        }
        break
      }
      let btnText = ''
      try {
        btnText = collectBtn.text() || collectBtn.desc() || ''
      } catch (e) {}
      this.pushLog('点击领取积分按钮：' + btnText + ' 第' + round + '次')
      this.displayButtonAndClick(collectBtn, '点击领取积分')
      sleep(1500)
      // 领取后可能弹出提示（领取成功/确定等），点击关闭
      let closeBtn = widgetUtils.widgetGetOne('完成|知道了|确定|关闭|好的', 1000)
      if (closeBtn) {
        this.displayButtonAndClick(closeBtn, '关闭领取提示')
        sleep(800)
      }
      // 若进入了新页面（如生活缴费），返回
      automator.back()
      sleep(1000)
      this.ensureCurrentInTaskPage()
    }
    FloatyInstance.setFloatyText('我的积分页面积分领取完毕')
  }

  /**
   * 领取快捷积分：立即领 + 再领1积分
   */
  this.collectQuickRewards = function () {
    this.ensureCurrentInTaskPage()
    sleep(1000)

    // 0. 检测今日快捷积分是否已领完（页面左侧显示“今日已领完”），已领完则跳过快捷积分领取
    if (widgetUtils.widgetCheck('今日已领完', 3000)) {
      this.pushLog('检测到今日已领完，跳过快捷积分领取')
      FloatyInstance.setFloatyText('今日已领完，跳过快捷积分')
      return
    }
    // 1. 点击"立即领"按钮（带红色感叹号表示有可领积分）
    FloatyInstance.setFloatyText('检测立即领按钮')
    let immediateBtn = widgetUtils.widgetGetOne('立即领', 2000)
    if (immediateBtn) {
      this.displayButtonAndClick(immediateBtn, '点击立即领')
      sleep(1500)
      // 立即领可能弹出领取成功提示，等待后返回
      automator.back()
      sleep(1000)
      this.ensureCurrentInTaskPage()
    } else {
      FloatyInstance.setFloatyText('未找到立即领按钮')
    }

    // 2. 点击"再领积分"按钮 -> 进入游戏中心 -> 等待访问成功弹框 -> 关闭返回（适配"再领1积分"/"再领50积分"等变体）
    FloatyInstance.setFloatyText('检测再领积分按钮')
    let extraBtn = widgetUtils.widgetGetOne('再领1积分', 2000)
    if (extraBtn) {
      // 检测“再领1积分”红包倒计时（如 17:44 / 01:23:45），倒计时未结束点击无效，跳过本次点击并安排倒计时结束后再执行
      let countdownWidget = widgetUtils.widgetGetOne('\\d+:\\d{2}(:\\d{2})?', 1000, true, true)
      if (countdownWidget && countdownWidget.content) {
        let cdSeconds = parseCountdownToSeconds(String(countdownWidget.content))
        if (cdSeconds > 0) {
          this.pushLog('检测到再领积分倒计时：' + countdownWidget.content + '，本次跳过点击，倒计时结束后再执行')
          FloatyInstance.setFloatyText('再领积分倒计时中，稍后自动再领')
          // 创建倒计时结束后的执行计划（+30秒缓冲），让蚂蚁积分在倒计时结束后再次执行并点击再领1积分
          this.createNextSchedule(this.taskCode, new Date().getTime() + (cdSeconds + 30) * 1000)
          return
        }
      }
      this.displayButtonAndClick(extraBtn, '点击再领积分')
      sleep(2000)
      // 等待游戏中心页面加载，检测"访问成功"或"获得积分"弹框
      let rewardGot = false
      let waitLimit = 10
      while (waitLimit-- > 0) {
        if (widgetUtils.widgetCheck('访问成功|获得积分|积分奖励', 1000)) {
          rewardGot = true
          FloatyInstance.setFloatyText('检测到积分领取成功弹框')
          break
        }
        if (widgetUtils.widgetCheck('玩游戏得积分|游戏中心', 1000)) {
          sleep(1000)
        } else {
          break
        }
      }
      if (rewardGot) {
        sleep(1000)
      }
      // 关闭弹框或返回签到页
      FloatyInstance.setFloatyText('关闭游戏中心返回签到页')
      let closeBtn = widgetUtils.widgetGetOne('关闭|\\(\\)', 1000)
      if (closeBtn) {
        this.displayButtonAndClick(closeBtn, '点击关闭按钮')
      } else {
        automator.back()
      }
      sleep(1500)
      // 如果还在游戏中心，再返回一次
      if (widgetUtils.widgetCheck('玩游戏得积分|游戏中心', 1000)) {
        automator.back()
        sleep(1500)
      }
      this.ensureCurrentInTaskPage()
    } else {
      FloatyInstance.setFloatyText('未找到再领积分按钮')
    }
  }



  this.enterCreditsTaskList = function () {
    let target = widgetUtils.widgetGetOne('每日签到')
    if (this.displayButtonAndClick(target, '准备执行签到浏览任务')) {
      sleep(1000)
      return true
    } else {
      FloatyInstance.setFloatyText('未能找到每日签到入口')
      sleep(1000)
    }
    return false
  }

  this.ensureCurrentInTaskPage = function () {
    let tmp
    if ((tmp = currentPackage()) != _package_name) {
      warnInfo(['检测到当前包名{}不正确，重新打开积分签到界面', tmp])
      return openSignPage()
    }
    let opened = false, limit = 5
    while (!(opened = widgetUtils.widgetWaiting(sign_page_widget, null, 1000)) && limit-- > 0) {
      automator.back()
      sleep(1000)
      if (currentPackage() != _package_name) {
        return openSignPage()
      }
    }
    if (opened) {
      return true
    }
    commonFunctions.minimize(_package_name)
    this.pushLog('未能打开积分签到任务界面， 重新打开')
    return openSignPage()
  }

  /**
   * 确保任务列表已展开：检测"赚更多积分"按钮是否在可见区域内，如可见则点击展开
   * 任务执行完返回后页面会回到签到页顶部，任务列表被收起，必须重新展开才能找到去完成/换一换按钮
   */
  this.expandTaskListIfNeeded = function () {
    sleep(500)
    let moreBtn = widgetUtils.widgetGetOne('赚更多积分', 1500)
    if (moreBtn) {
      try {
        let bounds = moreBtn.bounds()
        // 按钮在屏幕可见区域内（顶部70%区域）说明任务列表未展开，点击展开
        if (bounds && bounds.top() >= 0 && bounds.top() < config.device_height * 0.7) {
          this.pushLog('检测到赚更多积分按钮在可见区域，点击展开任务列表')
          FloatyInstance.setFloatyText('展开任务列表')
          this.displayButtonAndClick(moreBtn, '点击赚更多积分')
          sleep(1500)
          return
        }
      } catch (e) {
        logUtils.debugInfo('expandTaskListIfNeeded 检查按钮位置异常: ' + e)
      }
    }
    // 按钮不可见或在屏幕外（被上滑），说明任务列表已展开
    FloatyInstance.setFloatyText('任务列表已展开')
  }

  this.doTask = function (limit) {
    if (limit <= 0) {
      return
    }
    this.ensureCurrentInTaskPage()
    // 滑动到页面顶部，确保任务列表区域可见（底部滑动浏览后页面可能停留在底部）
    automator.gestureDown(config.device_height * 0.2, config.device_height * 0.7)
    sleep(500)
    // 确保任务列表已展开（任务执行完返回后页面会回到顶部，任务列表被收起，导致找不到去完成/换一换按钮）
    this.expandTaskListIfNeeded()
    this.pushLog('等待页面完全刷新 等待1秒')
    let wait = 1
    while (wait > 0) {
      this.replaceLastLog('等待页面完全刷新 等待' + wait-- + '秒')
      sleep(1000)
    }
    FloatyInstance.setFloatyText('查找任务')
    sleep(1000)
    let toFinishList = widgetUtils.widgetGetAll('\\s*去完成')
    if (!toFinishList || toFinishList.length <= 0) {
      // 双重保险：可能任务列表未展开，先展开再重试一次
      this.pushLog('未找到去完成按钮，尝试展开任务列表后重试')
      this.expandTaskListIfNeeded()
      sleep(1000)
      toFinishList = widgetUtils.widgetGetAll('\\s*去完成')
    }
    if (!toFinishList || toFinishList.length <= 0) {
      this.pushLog('无可完成任务')
      signFailedUtil.recordFailedWidgets(this.taskCode, '每日任务')
      // 展开后再找一次换一换
      this.expandTaskListIfNeeded()
      sleep(500)
      // 浏览任务已完成（显示"已完成浏览任务"），终止换一换避免空转
      if (widgetUtils.widgetCheck('.*已完成浏览任务.*', 1000)) {
        this.pushLog('检测到已完成浏览任务，终止任务列表刷新')
        return
      }
      let changeTask = widgetUtils.widgetGetOne('换一换', 1500)
      if (changeTask) {
        this.pushLog('没找到可执行的任务，换一换：' + limit)
        changeTask.click()
        sleep(2000)
        return this.doTask(limit - 1)
      }
      return
    }
    let anyFailed = false
    let toFinishBtn = toFinishList.map(v => {
      try {

        // 健壮的任务信息解析：递归收集容器中所有TextView文本，提取标题和积分值
        function collectTaskInfo (widget, depth, result) {
          if (!widget || depth > 8) return
          try {
            if (widget.className() == 'android.widget.TextView') {
              let t = widget.text()
              if (t && t.toString().trim().length > 0) {
                let txt = t.toString()
                result.texts.push(txt)
                // 提取积分值：+3积分、+300积分、+75积分
                let pm = txt.match(/\+(\d+)积分/)
                if (pm && !result.points) {
                  result.points = parseInt(pm[1])
                }
                // 第一个非按钮文本作为标题
                if (!result.title && txt != '去完成' && txt != '领取' && txt.indexOf('积分') < 0) {
                  result.title = txt
                  result.boundsInfo = widget.bounds()
                }
              }
            }
          } catch (e) {}
          let count = 0
          try { count = widget.childCount() } catch (e) { return }
          for (let i = 0; i < count; i++) {
            let child = widget.child(i)
            if (child) collectTaskInfo(child, depth + 1, result)
          }
        }
        function getTitle (btnWidget) {
          // 从按钮向上尝试多个父层级（1-6层），在每个层级的容器中递归收集任务信息
          for (let level = 1; level <= 6; level++) {
            let container = btnWidget
            let valid = true
            for (let l = 0; l < level; l++) {
              try {
                container = container.parent()
                if (!container) { valid = false; break }
              } catch (e) { valid = false; break }
            }
            if (!valid || !container) continue
            try {
              let info = { texts: [], title: null, points: null, boundsInfo: null }
              collectTaskInfo(container, 0, info)
              if (info.title) {
                return { title: info.title, points: info.points, boundsInfo: info.boundsInfo }
              }
            } catch (e) {}
          }
          logUtils.warnInfo('无法读取当前任务标题，控件结构已变更，使用默认标题兜底')
          return { title: '未知浏览任务', points: 3, boundsInfo: btnWidget.bounds() }
        }
        let boundsInfo = null, title = null, points = null
        try {
          let result = getTitle(v)
          title = result.title
          points = result.points
          boundsInfo = result.boundsInfo
        } catch (e) {
          commonFunctions.printExceptionStack(e)
          boundsInfo = v.bounds()
          title = '未知浏览任务'
          points = 5
        }

        // 只保留<=5积分的任务，超过5积分的任务（+300、+75等）需要真实消费/开通，无法通过脚本自动完成
        if (points !== null && points > 5) {
          logUtils.debugInfo(['跳过超过+5积分任务：标题={} 积分={}', title, points])
          return false
        }
        // 跳过邀请好友类任务（无法通过脚本自动完成）
        if (title && title.indexOf('邀请') > -1) {
          logUtils.debugInfo(['跳过邀请好友任务：标题={}', title])
          return false
        }

        if (title) {
          return {
            title: title,
            points: points,
            btn: v,
            titleBounds: boundsInfo
          }
        }
        return false
      } catch (e) {
        anyFailed = true
        logUtils.errorInfo('读取控件信息失败 可能控件信息又变了' + e)
        return false
      }
    }).filter(v => !!v)
    if (anyFailed) {
      signFailedUtil.recordFailedWidgets(this.taskCode, '任务控件信息')
    }
    // 提取当前可以执行的第一个任务
    let task = findFirstExecutableTask.call(this, toFinishBtn)
    // TODO 确保按钮在可见范围
    if (task && task.executable) {
      this.pushLog('执行任务：' + task.name)
      task.execute.apply(this)
      this.pushLog('当前任务执行完毕，尝试下一个任务')
      // 确保返回到任务列表页，避免停留在任务详情页导致后续任务无法获取
      this.ensureCurrentInTaskPage()
      sleep(1000)
      return this.doTask(limit)
    } else {
      // 检查当前页面是否还有未跳过的≤5积分任务
      let unskippedTasks = toFinishBtn.filter(info => skipTaskList.indexOf(info.title) < 0)
      if (unskippedTasks.length > 0) {
        // 还有未跳过的任务但类型不可执行，跳过它们后重试（不换一换，避免当前页面还有可做任务时被刷新掉）
        this.pushLog('当前页面还有' + unskippedTasks.length + '个≤5积分任务但类型不可执行，跳过后续任务列表')
        unskippedTasks.forEach(info => {
          if (info.title && info.title != '未知浏览任务') {
            skipTaskList.push(info.title)
          }
        })
        sleep(500)
        return this.doTask(limit)
      }
      // 所有≤5积分任务都已跳过或执行完毕，换一换刷新
      this.pushLog('当前页面所有≤5积分任务已处理完毕，换一换刷新')
      sleep(1000)
      // 浏览任务已完成（显示"已完成浏览任务"），终止换一换避免空转
      if (widgetUtils.widgetCheck('.*已完成浏览任务.*', 1000)) {
        this.pushLog('检测到已完成浏览任务，终止任务列表刷新')
        return
      }
      let changeTask = widgetUtils.widgetGetOne('换一换', 1000)
      if (changeTask) {
        this.pushLog('点击换一换刷新任务列表，剩余次数：' + limit)
        changeTask.click()
        sleep(2000)
        return this.doTask(limit - 1)
      }
    }

  }
  // 定义需要跳过的任务
  const skipTaskList = []
  function findFirstExecutableTask (buttonList) {
    if (!buttonList || buttonList.length == 0) {
      return false
    }


    let taskBuilderList = [
      // 首先构建 非视频\搜索\借呗的浏览任务
      () => buildTask(
        btnInfo => {
          let regex = /视频|搜索|借呗|传奇|游戏/
          return !regex.test(btnInfo.title) && btnInfo.title.indexOf('15秒') > -1
        },
        function (btn) {
          widgetUtils.widgetWaiting('点击或滑动')
          let limit = new CountdownChecker(16)
          let startY = config.device_height - config.device_height * 0.15
          let endY = startY - config.device_height * 0.3
          automator.gestureDown(startY, endY)
          this.pushLog('滑动浏览，等待' + limit.getRestTime() + '秒')
          while (!this.captureAndCheckByOcr('返回领积分', '返回领积分', null, null, false, 1)) {
            if (limit.isOvertime()) {
              break
            }
            this.replaceLastLog('滑动浏览，等待' + limit.getRestTime() + '秒')
            automator.gestureDown(startY, endY)
            sleep(1000)
          }
          automator.back()
          sleep(1000)
        }
      ),
      // 普通浏览/广告任务（新界面大量任务属于此类，如逛蚂蚁森林、汽车之家、红牛广告等）
      () =>
        buildTask(
          btnInfo => {
            let regex = /视频|搜索|借呗|传奇|游戏|15秒|小程序|饿了么|逛一逛|淘宝特价版/
            return !regex.test(btnInfo.title)
          },
          function (btn) {
            this.pushLog("普通浏览任务 点击进入 等待10秒 然后返回")
            let limit = 10
            while (limit-- > 0) {
              this.replaceLastLog("普通浏览任务等待" + limit + "秒")
              sleep(1000)
            }
            automator.back()
            sleep(1000)
          },
        ),
      // 搜索任务
      () => buildTask(btnInfo => btnInfo.title.indexOf('搜索') > -1,
        function (btn) {
          let searchDiscover = widgetUtils.widgetGetOne('搜索发现', 2000)
          if (searchDiscover) {
            // 点击第一个关键词
            searchDiscover.parent().child(1).child(0).child(0).click()
            let limit = new CountdownChecker(16)
            let startY = config.device_height - config.device_height * 0.15
            let endY = startY - config.device_height * 0.3
            while (widgetUtils.widgetWaiting('浏览得积分', 1000)) {
              if (limit.isOvertime()) {
                break
              }
              FloatyInstance.setFloatyText('等待' + limit.getRestTime() + '秒')
              automator.gestureDown(startY, endY)
              sleep(1000)
            }
            automator.back()
            sleep(1000)
            automator.back()
            sleep(1000)
          }
        }),
      // 借呗任务
      () => buildTask(
        btnInfo => btnInfo.title.indexOf('借呗') > -1,
        function (btn) {
          this.pushLog('借呗任务等待15秒')
          sleep(1000)
          let limit = 15
          while (limit-- > 0) {
            this.replaceLastLog('借呗任务等待' + limit + '秒')
            sleep(1000)
          }
          if (widgetUtils.widgetGetOne('.*逛一逛.*', 1000)) {
            this.pushLog('检测到目标控件，继续等待5s')
            sleep(5000)
          }
          automator.back()
          sleep(1000)
        }
      ),
      // 简单的小程序任务
      () => buildTask((btnInfo) => {
        let regex = /小程序|饿了么|逛一逛|淘宝特价版/
        return regex.test(btnInfo.title)
      },
        function (btn) {
          this.pushLog('小程序任务 点击进入 等待10秒 然后返回')
          let limit = 10
          while (limit-- > 0) {
            this.replaceLastLog('小程序任务等待' + limit + '秒')
            sleep(1000)
          }
          automator.back()
          sleep(1000)
        }
      ),
    ]

    for (let i = 0; i < taskBuilderList.length; i++) {
      let task = taskBuilderList[i]()
      if (task) {
        return task
      }
    }
    this.pushLog('当前任务列表均未定义无法执行：' + JSON.stringify(buttonList.map(info => info.title)))
    return null

    function buildTask (filter, execute) {
      debugInfo(['跳过的任务列表：{}', skipTaskList])
      let resultList = buttonList.filter(btnInfo => skipTaskList.indexOf(btnInfo.title) < 0 && filter(btnInfo))
      if (resultList.length > 0) {
        return {
          name: resultList[0].title,
          executable: true,
          execute: function () {
            let target = resultList[0]
            // // 移动到任务区域，确保 去完成按钮 正确
            // let btn = this.ensureTargetInVisible(target.btn,
            //   [0, config.device_height * 0.1, config.device_width, config.device_height * 0.8],
            //   () => widgetUtils.widgetGetOne(target.title)
            // )
            // sleep(1000)
            // // 通过控件重新获取标题对应的去完成按钮
            // let titleContainer = widgetUtils.widgetGetOne(target.title, 1000)
            // if (titleContainer) {
            //   let bns = titleContainer.bounds()
            //   warningFloaty.addRectangle('查找去完成按钮', [bns.left, bns.top, config.device_width - bns.left, bns.height() * 3.5])
            //   btn = boundsInside(bns.left, bns.top, config.device_width, bns.bottom + bns.height() * 2.5).textContains('去完成').findOne(1000)
            //   if (btn) {
            //     debugInfo(['重新获取控件{}', JSON.stringify(btn.bounds())])
            //   } else {
            //     skipTaskList.push(target.title)
            //     this.pushWarningLog('无法正确找到 去完成 按钮')
            //     warnInfo(['重新获取去完成控件失败，任务名称：{}', target.title])
            //   }
            // } else {
            //   this.pushWarningLog('无法正确找到任务标题:' + new RegExp(target.title).source)
            //   warnInfo(['未能重新找到标题：' + target.title])
            // }
            // if (this.displayButtonAndClick(btn, '去完成', null, false)) {
            // 修复：优先使用控件click，失败则用clickCenter点击按钮中心，确保点到按钮本身而非任务卡片
            let clicked = false
            try {
              if (target.btn.clickable && target.btn.clickable()) {
                clicked = target.btn.click()
              }
            } catch (e) {
              logUtils.debugInfo('按钮clickable属性获取异常，改用坐标点击')
            }
            if (!clicked) {
              automator.clickCenter(target.btn)
              clicked = true
            }
            if (clicked) {
              // 标记当前任务执行完毕，如果失败了 不再重复执行 避免死循环
              // 注意：默认标题"未知浏览任务"不加入跳过列表，防止标题解析失败时所有任务因标题相同被全部跳过
              if (target.title && target.title != '未知浏览任务') {
                skipTaskList.push(target.title)
              }
              sleep(1500)
              warningFloaty.clearAll()
              // 处理可能弹出的任务详情弹框（点击到卡片非按钮区域时，如图4）
              this.handleTaskDetailDialog()
              return execute.apply(this, [target.btn])
            } else {
              this.pushWarningLog('去完成按钮点击失败')
              let bns = resultList[0].btn.bounds()
              warningFloaty.addRectangle('未找到去完成按钮', [bns.left, bns.top, bns.width(), bns.height()])
              sleep(1000)
              warningFloaty.clearAll()
            }
          }
        }
      }
    }
  }

  /**
   * 处理任务详情弹框（点击去完成后可能弹出的任务确认弹框，如图4）
   * 如果弹框中有"去完成"按钮则点击，否则关闭弹框
   */
  this.handleTaskDetailDialog = function () {
    sleep(800)
    // 检测任务详情弹框特征："奖励X积分" 或 "领取任务后" 文字
    if (widgetUtils.widgetCheck('奖励.*积分|领取任务后|24小时内', 1200)) {
      FloatyInstance.setFloatyText('检测到任务详情弹框')
      sleep(500)
      // 弹框中通常有"去完成"按钮，点击它进入任务页面
      let dialogFinishBtn = widgetUtils.widgetGetOne('去完成', 1500)
      if (dialogFinishBtn) {
        this.displayButtonAndClick(dialogFinishBtn, '点击弹框中的去完成')
        sleep(1500)
      } else {
        // 没有去完成按钮，尝试关闭弹框
        FloatyInstance.setFloatyText('弹框中未找到去完成，关闭弹框')
        let closeBtn = widgetUtils.widgetGetOne('关闭|\\(\\)', 1000)
        if (closeBtn) {
          this.displayButtonAndClick(closeBtn, '关闭弹框')
        } else {
          automator.back()
        }
        sleep(1000)
      }
    }
  }

  this.doBrowseTask = function () {
    // 新界面：领取快捷积分（立即领 + 再领1积分）
    this.collectQuickRewards()
    // 点击"赚更多积分"展开任务列表（页面会自动上滑）
    FloatyInstance.setFloatyText('点击赚更多积分展开任务列表')
    let moreBtn = widgetUtils.widgetGetOne('赚更多积分', 2000)
    if (moreBtn) {
      this.displayButtonAndClick(moreBtn, '点击赚更多积分')
      sleep(1500)
    } else {
      FloatyInstance.setFloatyText('未找到赚更多积分按钮，任务列表可能已展开')
    }
  }

  /**
   * 滑动浏览任务：滑动浏览以下内容得积分（如"滑动浏览以下内容2秒/15秒，得5积分"）
   * 任务条可能在页面顶部或底部，先检测当前页面，找不到再滑动查找；
   * 找到后点击任务条进入内容页，在内容页滑动浏览16秒，完成后返回
   */
  this.doBottomBrowseTask = function () {
    // 滑动浏览任务已完成（页面显示"已完成浏览任务"，该任务一天一般2次），直接跳过终止
    if (widgetUtils.widgetCheck('.*已完成浏览任务.*', 1500)) {
      this.pushLog('检测到已完成浏览任务，跳过滑动浏览')
      FloatyInstance.setFloatyText('已完成浏览任务，跳过')
      return
    }

    let startY = config.device_height - config.device_height * 0.15
    let endY = startY - config.device_height * 0.3
    let browsePattern = '滑动浏览|浏览以下内容|浏览.*秒.*积分'

    // 1. 先检测当前页面是否有滑动浏览任务（不滑动，任务条可能在页面顶部）
    let found = widgetUtils.widgetCheck(browsePattern, 1500)
    if (!found) {
      // 2. 当前页面没有，向下滑动查找（可能在页面底部）
      this.pushLog('当前页面未检测到滑动浏览任务，向下滑动查找')
      automator.gestureDown(startY, endY)
      sleep(1000)
      automator.gestureDown(startY, endY)
      sleep(1000)
      found = widgetUtils.widgetCheck(browsePattern, 1500)
    }
    if (!found) {
      FloatyInstance.setFloatyText('未找到滑动浏览任务')
      this.pushLog('未检测到滑动浏览任务，跳过')
      return
    }
    this.pushLog('检测到滑动浏览任务，点击进入内容页')
    FloatyInstance.setFloatyText('滑动浏览任务开始')
    // 3. 点击滑动浏览任务条，进入内容页（如兑好物页面）
    let browseTask = widgetUtils.widgetGetOne(browsePattern, 1500)
    if (browseTask) {
      this.displayButtonAndClick(browseTask, '点击滑动浏览任务')
      sleep(2000)
    }
    // 点击后可能弹出任务确认弹框（如"去完成"），处理弹框进入内容页
    this.handleTaskDetailDialog()
    sleep(1000)
    // 4. 在内容页滑动浏览16秒（可能有多轮 1/2, 2/2）
    let round = 0
    while (round < 3) {
      round++
      this.pushLog('滑动浏览任务 第' + round + '轮')
      FloatyInstance.setFloatyText('滑动浏览 第' + round + '轮')
      let limit = new CountdownChecker(16) // 15秒+1秒缓冲
      while (!limit.isOvertime()) {
        this.replaceLastLog('滑动浏览，等待' + limit.getRestTime() + '秒')
        automator.gestureDown(startY, endY)
        sleep(1000)
      }
      sleep(1500)
      // 检查是否还有下一轮（进度条 1/2, 2/2）
      if (!widgetUtils.widgetCheck(browsePattern, 1000)) {
        break
      }
    }
    this.pushLog('滑动浏览任务完成，共' + round + '轮')
    // 5. 返回任务列表页
    automator.back()
    sleep(1000)
    this.ensureCurrentInTaskPage()
  }

  /**
   * v2.5.0 执行流程：
   * 1. 领取快捷积分（立即领 + 再领积分）+ 展开任务列表
   * 2. 优先执行底部滑动浏览任务（固定存在，不受换一换影响）
   * 3. 执行福利任务（只执行<=5积分任务，非<=5积分通过换一换刷新，最多10次）
   */
  this.executeTasks = function () {
    if (!widgetUtils.widgetCheck(sign_page_widget, 8000)) {
      this.pushLog('未打开积分签到任务界面 重新打开')
      // 重新打开成功则回写签到成功标记，避免 checkAndCollect 阶段冷启动超时导致任务误判失败
      if (openSignPage()) {
        this.sign_success = true
        commonFunctions.setAliCreditsSigned()
      }
      sleep(1000)
    }
    // 领取快捷积分（立即领 + 再领积分）+ 展开任务列表
    this.doBrowseTask()

    // 优先执行底部滑动浏览任务（固定存在，不受换一换影响）
    this.doBottomBrowseTask()
    // 底部滑动浏览后页面停留在底部，滑动回到任务列表区域
    sleep(500)
    automator.gestureDown(config.device_height * 0.2, config.device_height * 0.7)
    sleep(1000)
    this.expandTaskListIfNeeded()

    // 执行福利任务（只执行<=5积分任务，非<=5积分通过换一换刷新，最多10次）
    this.doTask(10)
    automator.back()
  }

  this.doExection = function () {
    FloatyInstance.setFloatyPosition(400, 400)
    FloatyInstance.setFloatyText('准备打开领取积分页面')
    this.openCreditPage()
    // 领取"我的积分"页面上的积分按钮（如"生活缴费 领取4积分"）
    FloatyInstance.setFloatyText('准备领取页面积分')
    this.collectPageRewards()
    FloatyInstance.setFloatyText('准备领取积分')
    this.sign_success = this.checkAndCollect()
    FloatyInstance.setFloatyText('准备执行每日任务')
    this.executeTasks()
  }

  this.exec = function () {
    this.doExection()
    FloatyInstance.setFloatyText('领取完毕')
    // 仅当日签到真正完成时才标记已执行，避免界面变更导致的误标记阻断重跑
    if (this.sign_success) {
      this.setExecuted()
    }
    commonFunctions.minimize(_package_name)
  }

  function openSignPage () {
    let url = 'alipays://platformapi/startapp?appId=20000067&url=https%3A%2F%2Frender.alipay.com%2Fp%2Fyuyan%2F180020380000000023%2Fpoint-sign-in.html%3FchInfo%3D&launchKey=3755a1a6-6b02-4508-8714-cd2d393b08e9-1704164626631'
    let openResult = false
    // 支付宝 H5 签到页冷启动加载慢，单次打开可能超时；多轮重试直到页面加载成功
    for (let i = 0; i < 3; i++) {
      app.startActivity({
        action: 'android.intent.action.VIEW',
        data: url,
        packageName: 'com.eg.android.AlipayGphone'
      })
      openResult = widgetUtils.widgetWaiting(sign_page_widget, null, 8000)
      if (openResult) {
        break
      }
      _this.pushLog('打开签到页第' + (i + 1) + '次失败，重新尝试')
      sleep(2000)
    }
    _this.pushLog('打开结果：' + openResult)
    return openResult
  }

  /**
   * 解析倒计时文本（mm:ss 或 hh:mm:ss）为秒数，无法解析返回 0
   * @param {string} text 倒计时文本，如 "17:44"、"01:23:45"
   * @returns {number} 剩余秒数
   */
  function parseCountdownToSeconds (text) {
    if (!text) return 0
    let parts = String(text).trim().split(':')
    let h = 0
    let min = 0
    let sec = 0
    if (parts.length === 2) {
      min = parseInt(parts[0], 10) || 0
      sec = parseInt(parts[1], 10) || 0
    } else if (parts.length === 3) {
      h = parseInt(parts[0], 10) || 0
      min = parseInt(parts[1], 10) || 0
      sec = parseInt(parts[2], 10) || 0
    } else {
      return 0
    }
    return h * 3600 + min * 60 + sec
  }

  function CountdownChecker (limit) {
    this.start = new Date().getTime()
    this.limit = limit

    this.getPassTime = function () {
      return Math.floor((new Date().getTime() - this.start) / 1000)
    }

    this.isOvertime = function () {
      return this.getPassTime() > this.limit
    }

    this.getRestTime = function () {
      return (this.limit - this.getPassTime()).toFixed(0)
    }
  }

}

CreditRunner.prototype = Object.create(BaseSignRunner.prototype)
CreditRunner.prototype.constructor = CreditRunner

module.exports = new CreditRunner()
