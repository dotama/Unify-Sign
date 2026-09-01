/*
 * @Description: 重置支付宝商家积分的当日执行状态，用于界面变更或误标记后重新执行
 * 1. 重置当日"商家积分已签到"标记
 * 2. 删除今日"支付宝商家积分签到"任务的执行计划，下次运行 main.js（或可视化配置->生成执行计划）时会重新生成并执行
 */
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let storageFactory = singletonRequire('StorageFactory')
let logUtils = singletonRequire('LogUtils')
let signTaskService = singletonRequire('SignTaskService')
let formatDate = require('../lib/DateUtil.js')

logUtils.infoLog('======初始化SQLite=======')
signTaskService.init()

// 1. 重置当日"商家积分已签到"标记
storageFactory.updateValueByKey('alimerchaint_DAILY_SIGNED', { executed: false })
logUtils.infoLog('已重置支付宝商家积分当日已签到标记')

// 2. 删除今日商家积分任务的执行计划
let today = formatDate(new Date(), 'yyyy-MM-dd')
let schedules = signTaskService.listTaskScheduleByDate(today, 'AlipayMerchant')
if (schedules && schedules.length > 0) {
  schedules.forEach(schedule => {
    logUtils.infoLog(['删除今日商家积分执行计划 id:{} 状态:{} 执行时间:{}', schedule.id, schedule.executeStatus, formatDate(new Date(schedule.executeTime))])
    signTaskService.deleteTaskScheduleById(schedule.id)
  })
} else {
  logUtils.infoLog('今日暂无商家积分执行计划')
}
logUtils.infoLog('重置完成。之后运行 main.js 即可重新执行支付宝商家积分任务')
