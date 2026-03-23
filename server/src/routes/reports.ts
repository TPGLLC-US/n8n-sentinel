import { Router, Request, Response } from 'express';
import { query } from '../db';
import { sendReport, gatherReportData } from '../services/reports';
import { renderMonitoringReport } from '../emails/MonitoringReport';
import { startReportScheduler } from '../services/report-scheduler';
import { getSetting } from './settings';

const router = Router();

// POST /api/reports/send — Send a report now (manual trigger)
router.post('/send', async (req: Request, res: Response) => {
    try {
        const { period } = req.body as { period?: 'daily' | 'weekly' | 'monthly' };
        if (!period || !['daily', 'weekly', 'monthly'].includes(period)) {
            return res.status(400).json({ error: 'period must be daily, weekly, or monthly' });
        }

        const result = await sendReport({ period, triggeredBy: 'manual' });

        if (result.success) {
            res.json({ success: true, resendId: result.resendId });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error: any) {
        console.error('Error sending report:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/reports/test — Send a test report to a specific email
router.post('/test', async (req: Request, res: Response) => {
    try {
        const { period, email } = req.body as { period?: 'daily' | 'weekly' | 'monthly'; email?: string };
        if (!email) {
            return res.status(400).json({ error: 'email is required for test sends' });
        }
        const testPeriod = period || 'daily';

        const result = await sendReport({
            period: testPeriod,
            triggeredBy: 'test',
            recipientOverride: [email],
        });

        if (result.success) {
            res.json({ success: true, resendId: result.resendId, sentTo: email });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error: any) {
        console.error('Error sending test report:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/reports/preview — Get rendered HTML without sending
router.post('/preview', async (req: Request, res: Response) => {
    try {
        const { period } = req.body as { period?: 'daily' | 'weekly' | 'monthly' };
        const previewPeriod = period || 'daily';

        const breakdownSetting = await getSetting('report_instance_breakdown');
        const data = await gatherReportData(previewPeriod, breakdownSetting === 'true');
        const html = await renderMonitoringReport(data);

        res.json({ html, data });
    } catch (error: any) {
        console.error('Error generating report preview:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/reports/history — List sent reports
router.get('/history', async (req: Request, res: Response) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const result = await query(
            `SELECT id, period, recipients, subject, status, error_message, resend_id, 
                    date_from, date_to, triggered_by, sent_at
             FROM report_history
             ORDER BY sent_at DESC
             LIMIT $1`,
            [limit]
        );
        res.json({ reports: result.rows });
    } catch (error: any) {
        console.error('Error fetching report history:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/reports/refresh-schedule — Re-read settings and restart cron jobs
router.post('/refresh-schedule', async (req: Request, res: Response) => {
    try {
        await startReportScheduler();
        res.json({ success: true, message: 'Report scheduler refreshed' });
    } catch (error: any) {
        console.error('Error refreshing report scheduler:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
