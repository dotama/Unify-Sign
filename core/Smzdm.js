/**
 * 什么值得买
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
let logUtils = singletonRequire('LogUtils')
// 本地OCR工具 按需引用
let localOcrUtil = require('../lib/LocalOcrUtil.js')

let BaseSignRunner = require('./BaseSignRunner.js')
function SignRunner () {
  BaseSignRunner.call(this)

  /**
   *  扩展exec代码 实现具体的签到逻辑
   */
  this.exec = function () {
    // 打开APP
    this.launchApp()
    // 执行签到
    this.doSign()
    commonFunctions.minimize()
  }

  this.launchApp = function () {
    commonFunctions.launchPackage('com.smzdm.client.android')
    sleep(500)
    this.awaitAndSkip()
    this.closeAdDialog()
  }

  this.closeAdDialog = function () {
    FloatyInstance.setFloatyText('查找是否有关闭广告')
    let close = widgetUtils.widgetGetById('com.smzdm.client.android:id/dialog_home_close', 1000)
    this.displayButtonAndClick(close, '关闭广告', 1000)
  }

  /**
   * 读取控件及其子控件的全部文字，用于识别签到按钮上的文案（按钮可能是多个 TextView 组合）
   */
  this.readWidgetText = function (widget, depth) {
    if (!widget) return ''
    depth = depth || 0
    if (depth > 5) return ''
    let text = ''
    try { text = widget.text() || '' } catch (err) {}
    let count = 0
    try { count = widget.childCount() } catch (err) { return text.trim() }
    for (let i = 0; i < count; i++) {
      let childText = this.readWidgetText(widget.child(i), depth + 1)
      if (childText) text = text + ' ' + childText
    }
    return text.trim()
  }

  /**
   * 判定个人中心页的签到状态
   * 注意 WidgetUtils 的 textMatches 是整串全匹配，必须用 .* 兼容按钮文案里的天数
   * 已签到：按钮显示“已签 4006天”（也可能拆成“已签”+“4006天”两个控件）
   */
  this.checkSignedOnProfile = function () {
    if (widgetUtils.widgetCheck('已签.*', 2500)) return true
    if (widgetUtils.widgetCheck('签到成功.*', 1200)) return true
    return false
  }

  this.doSign = function () {
    FloatyInstance.setFloatyText('查找我的')
    // 底部导航“我的”在偏右的第三个位置，优先按 id 查找，找不到再按文案
    let mine = widgetUtils.widgetGetById('com.smzdm.client.android:id/tab_usercenter', 2500)
    if (!mine) {
      mine = widgetUtils.widgetGetOne('我的', 2000)
    }
    if (!mine) {
      this.pushErrorLog('未找到“我的”入口，无法进入个人中心')
      return false
    }
    this.displayButtonAndClick(mine, '点击我的', 1500)
    sleep(1800)

    // 先判定是否已经签过（避免重复点击、也保证签过能正确标记，不再反复调度）
    if (this.checkSignedOnProfile()) {
      this.pushLog('个人中心已显示已签到状态（已签N天），今日签到已完成')
      this.setExecuted()
      return true
    }

    // 签到按钮在页面上部偏右（用户名右侧），优先按 id，其次按文案“签到”
    FloatyInstance.setFloatyText('查找签到按钮')
    let entry = widgetUtils.widgetGetById('com.smzdm.client.android:id/v_container_login_not_sign_animation', 1500)
    if (!entry) {
      entry = widgetUtils.widgetGetById('com.smzdm.client.android:id/v_login_sign.*', 1500)
    }
    if (!entry) {
      entry = widgetUtils.widgetGetOne('签到', 2000)
    }
    if (!entry) {
      entry = widgetUtils.widgetGetOne('立即签到|去签到|签个到', 2000)
    }
    if (!entry) {
      // 兜底：按钮文案可能带后缀（如“签到领积分”），在页面上部区域找包含“签到”的控件，排除日历/任务/成就等干扰项
      let candidates = widgetUtils.widgetGetAll('.*签到.*')
      if (candidates && candidates.length > 0) {
        let excludes = ['日历', '任务', '成就', '补签', '规则', '明细', '奖励', '记录']
        for (let i = 0; i < candidates.length; i++) {
          let bd = candidates[i].bounds()
          if (!bd || bd.top() > config.device_height * 0.6) continue
          let txt = this.readWidgetText(candidates[i])
          let skipIt = false
          excludes.forEach(function (kw) { if (txt.indexOf(kw) > -1) skipIt = true })
          if (skipIt) continue
          this.pushLog('兜底匹配到签到控件，文案：' + txt)
          entry = candidates[i]
          break
        }
      }
    }
    if (!entry) {
      this.pushErrorLog('未找到签到按钮（页面上部偏右），今日签到未完成')
      return false
    }
    this.pushLog('找到签到按钮，文案：' + this.readWidgetText(entry))
    this.displayButtonAndClick(entry, '点击签到按钮', 1800)
    sleep(2000)

    // 情况一：点击后直接签到成功，按钮文案变为“已签 N天”
    if (this.checkSignedOnProfile()) {
      this.pushLog('签到成功，按钮已变为已签N天')
      this.setExecuted()
      return true
    }

    // 情况二：跳转到签到中心页（顶部“已连续签到 N天”），在页内找签到按钮点击
    if (widgetUtils.widgetCheck('已连续签到.*', 1500)) {
      this.pushLog('已进入签到中心页，查找页内签到按钮')
      let signBtn = widgetUtils.widgetGetOne('签到', 2000)
      if (!signBtn) {
        signBtn = widgetUtils.widgetGetOne('立即签到|去签到|签到领.*', 1500)
      }
      if (signBtn) {
        this.pushLog('点击签到中心页的签到按钮')
        this.displayButtonAndClick(signBtn, '点击签到', 2000)
        sleep(2000)
        if (widgetUtils.widgetCheck('签到成功.*', 1500)) {
          this.pushLog('签到中心页签到成功')
          this.setExecuted()
          return true
        }
        // 回个人中心核对按钮文案是否变为“已签 N天”
        automator.back()
        sleep(1800)
        if (this.checkSignedOnProfile()) {
          this.pushLog('返回个人中心确认已签到')
          this.setExecuted()
          return true
        }
      }
    }
    this.pushErrorLog('已点击签到按钮，但未检测到已签到状态')
    return false
  }

}

SignRunner.prototype = Object.create(BaseSignRunner.prototype)
SignRunner.prototype.constructor = SignRunner
module.exports = new SignRunner()
