import { schedule as cronSchedule, ScheduledTask } from 'node-cron';
import { sendReport } from './reports';
import { getSetting } from '../routes/settings';

let dailyJob: ScheduledTask | null = null;
let weeklyJob: ScheduledTask | null = null;
let monthlyJob: ScheduledTask | null = null;

/**
 * Read schedule settings from DB and (re)start cron jobs accordingly.
 * Call on startup and whenever report settings change.
 */
export async function startReportScheduler(): Promise<void> {
    // Stop existing jobs
    stopReportScheduler();

    const schedule = await getSetting('report_schedule');
    if (!schedule || schedule === 'none') {
        console.log('[report-scheduler] No schedule configured, skipping');
        return;
    }

    const enabledPeriods = schedule.split(',').map(s => s.trim());
    const dailyHour = parseInt(await getSetting('report_daily_hour') || '8');
    const weeklyDay = parseInt(await getSetting('report_weekly_day') || '1'); // Monday
    const monthlyDay = parseInt(await getSetting('report_monthly_day') || '1');

    if (enabledPeriods.includes('daily')) {
        const cronExpr = `0 ${dailyHour} * * *`;
        dailyJob = cronSchedule(cronExpr, async () => {
            console.log('[report-scheduler] Running daily report...');
            await sendReport({ period: 'daily', triggeredBy: 'scheduler' });
        }, { timezone: 'UTC' });
        console.log(`[report-scheduler] Daily report scheduled at ${dailyHour}:00 UTC`);
    }

    if (enabledPeriods.includes('weekly')) {
        const cronExpr = `0 ${dailyHour} * * ${weeklyDay}`;
        weeklyJob = cronSchedule(cronExpr, async () => {
            console.log('[report-scheduler] Running weekly report...');
            await sendReport({ period: 'weekly', triggeredBy: 'scheduler' });
        }, { timezone: 'UTC' });
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        console.log(`[report-scheduler] Weekly report scheduled for ${dayNames[weeklyDay]} at ${dailyHour}:00 UTC`);
    }

    if (enabledPeriods.includes('monthly')) {
        const cronExpr = `0 ${dailyHour} ${monthlyDay} * *`;
        monthlyJob = cronSchedule(cronExpr, async () => {
            console.log('[report-scheduler] Running monthly report...');
            await sendReport({ period: 'monthly', triggeredBy: 'scheduler' });
        }, { timezone: 'UTC' });
        console.log(`[report-scheduler] Monthly report scheduled for day ${monthlyDay} at ${dailyHour}:00 UTC`);
    }
}

export function stopReportScheduler(): void {
    if (dailyJob) { dailyJob.stop(); dailyJob = null; }
    if (weeklyJob) { weeklyJob.stop(); weeklyJob = null; }
    if (monthlyJob) { monthlyJob.stop(); monthlyJob = null; }
}
