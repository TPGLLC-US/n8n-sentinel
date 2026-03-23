import {
    Html,
    Head,
    Body,
    Container,
    Section,
    Text,
    Heading,
    Preview,
    Img,
} from '@react-email/components';
import { render } from '@react-email/render';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AlertEmailData {
    alertType: string;
    severity: string;
    message: string;
    instanceName: string;
    triggeredAt: string;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const main = {
    backgroundColor: '#0f1117',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container = {
    margin: '0 auto',
    padding: '24px 16px',
    maxWidth: '600px',
};

const card = {
    backgroundColor: '#1a1d27',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
    border: '1px solid #2a2d3a',
};

const heading = {
    color: '#f0f0f0',
    fontSize: '20px',
    fontWeight: '600' as const,
    margin: '0 0 4px 0',
};

const subheading = {
    color: '#888',
    fontSize: '12px',
    margin: '0',
};

const severityColors: Record<string, { bg: string; border: string; text: string }> = {
    critical: { bg: '#ef444520', border: '#ef444440', text: '#ef4444' },
    warning: { bg: '#f59e0b20', border: '#f59e0b40', text: '#f59e0b' },
    info: { bg: '#3b82f620', border: '#3b82f640', text: '#3b82f6' },
};

const alertTypeLabels: Record<string, string> = {
    heartbeat_missed: 'Missed Heartbeat',
    error_rate_high: 'High Error Rate',
    workflow_count_zero: 'Zero Workflows',
    workflow_count_drop: 'Workflow Count Drop',
    workflow_count_spike: 'Workflow Count Spike',
    instance_url_mismatch: 'Instance URL Mismatch',
    reporter_outdated: 'Reporter Outdated',
};

// ─── Component ───────────────────────────────────────────────────────────────

function AlertNotification({ data }: { data: AlertEmailData }) {
    const colors = severityColors[data.severity] || severityColors.warning;
    const typeLabel = alertTypeLabels[data.alertType] || data.alertType;
    const time = new Date(data.triggeredAt).toLocaleString();

    return (
        <Html>
            <Head />
            <Preview>{`[${data.severity.toUpperCase()}] ${typeLabel} — ${data.instanceName}`}</Preview>
            <Body style={main}>
                <Container style={container}>
                    {/* Header */}
                    <Section style={{ marginBottom: '20px' }}>
                        <Img
                            src="https://rss.imagecdn.realsimplesolutions.ai/Assets/img/n8n-sentinal-logo.png"
                            alt="Sentinel"
                            height="40"
                            style={{ borderRadius: '8px', marginBottom: '12px' }}
                        />
                        <Heading style={heading}>Sentinel Alert</Heading>
                        <Text style={subheading}>{time}</Text>
                    </Section>

                    {/* Severity Badge + Type */}
                    <Section style={card}>
                        <table width="100%" cellPadding={0} cellSpacing={0}>
                            <tbody>
                                <tr>
                                    <td>
                                        <Text style={{
                                            display: 'inline-block',
                                            backgroundColor: colors.bg,
                                            border: `1px solid ${colors.border}`,
                                            color: colors.text,
                                            fontSize: '11px',
                                            fontWeight: '600',
                                            padding: '3px 10px',
                                            borderRadius: '4px',
                                            margin: '0 0 12px 0',
                                            textTransform: 'uppercase' as const,
                                        }}>
                                            {data.severity}
                                        </Text>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <Text style={{ color: '#f0f0f0', fontSize: '16px', fontWeight: '600', margin: '0 0 4px 0' }}>
                                            {typeLabel}
                                        </Text>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <Text style={{ color: '#ccc', fontSize: '14px', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                                            {data.message}
                                        </Text>
                                    </td>
                                </tr>
                                <tr>
                                    <td>
                                        <table cellPadding={0} cellSpacing={0}>
                                            <tbody>
                                                <tr>
                                                    <td style={{ paddingRight: '24px' }}>
                                                        <Text style={{ color: '#888', fontSize: '11px', margin: '0' }}>Instance</Text>
                                                        <Text style={{ color: '#f0f0f0', fontSize: '13px', margin: '2px 0 0 0', fontWeight: '500' }}>{data.instanceName}</Text>
                                                    </td>
                                                    <td>
                                                        <Text style={{ color: '#888', fontSize: '11px', margin: '0' }}>Alert Type</Text>
                                                        <Text style={{ color: '#f0f0f0', fontSize: '13px', margin: '2px 0 0 0', fontWeight: '500' }}>{typeLabel}</Text>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </Section>

                    {/* Footer */}
                    <Section style={{ textAlign: 'center' as const, paddingTop: '8px' }}>
                        <Text style={{ color: '#555', fontSize: '11px', margin: '0' }}>
                            You're receiving this because alert email notifications are enabled in Sentinel settings.
                        </Text>
                    </Section>
                </Container>
            </Body>
        </Html>
    );
}

// ─── Render Helper ───────────────────────────────────────────────────────────

export async function renderAlertNotification(data: AlertEmailData): Promise<string> {
    return render(<AlertNotification data={data} />);
}
