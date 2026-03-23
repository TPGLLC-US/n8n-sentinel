import {
    Html,
    Head,
    Body,
    Container,
    Section,
    Text,
    Hr,
    Row,
    Column,
    Heading,
    Preview,
    Img,
} from '@react-email/components';
import { render } from '@react-email/render';
import type { ReportData, InstanceStats } from '../services/reports';

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
    border: '1px solid #2a2d3a',
    padding: '20px',
    marginBottom: '16px',
};

const heading = {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '600' as const,
    margin: '0 0 4px 0',
};

const subheading = {
    color: '#a1a1aa',
    fontSize: '13px',
    margin: '0 0 20px 0',
};

const sectionTitle = {
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600' as const,
    margin: '0 0 12px 0',
};

const statValue = {
    color: '#ffffff',
    fontSize: '28px',
    fontWeight: '700' as const,
    margin: '0',
    lineHeight: '1',
};

const statLabel = {
    color: '#a1a1aa',
    fontSize: '11px',
    margin: '4px 0 0 0',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
};

const tableHeader = {
    color: '#a1a1aa',
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '6px 8px',
    borderBottom: '1px solid #2a2d3a',
    textAlign: 'left' as const,
};

const tableCell = {
    color: '#e4e4e7',
    fontSize: '13px',
    padding: '8px',
    borderBottom: '1px solid #1f2230',
};

const tableCellRight = {
    ...tableCell,
    textAlign: 'right' as const,
    fontFamily: 'monospace',
};

const badgeGreen = {
    display: 'inline-block',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: '#34d399',
    fontSize: '11px',
    fontWeight: '500' as const,
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(16, 185, 129, 0.2)',
};

const badgeRed = {
    ...badgeGreen,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: '#f87171',
    border: '1px solid rgba(239, 68, 68, 0.2)',
};

const badgeAmber = {
    ...badgeGreen,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    color: '#fbbf24',
    border: '1px solid rgba(245, 158, 11, 0.2)',
};

const badgeViolet = {
    ...badgeGreen,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    color: '#a78bfa',
    border: '1px solid rgba(139, 92, 246, 0.2)',
};

const hr = {
    borderColor: '#2a2d3a',
    margin: '16px 0',
};

const footer = {
    color: '#71717a',
    fontSize: '11px',
    textAlign: 'center' as const,
    margin: '24px 0 0 0',
};

// ─── Component ───────────────────────────────────────────────────────────────

function MonitoringReport({ data }: { data: ReportData }) {
    const periodLabel = data.period.charAt(0).toUpperCase() + data.period.slice(1);
    const fromDate = new Date(data.dateRange.from).toLocaleDateString();
    const toDate = new Date(data.dateRange.to).toLocaleDateString();

    return (
        <Html>
            <Head />
            <Preview>{`Sentinel ${periodLabel} Report — ${data.newErrors} errors, ${data.totalExecutions} executions`}</Preview>
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
                        <Heading style={heading}>Sentinel {periodLabel} Report</Heading>
                        <Text style={subheading}>{fromDate} — {toDate}</Text>
                    </Section>

                    {/* Stats Overview */}
                    <Section style={card}>
                        <table width="100%" cellPadding={0} cellSpacing={0}>
                            <tbody>
                                <tr>
                                    <td style={{ textAlign: 'center', width: '25%' }}>
                                        <Text style={statValue}>{data.totalExecutions.toLocaleString()}</Text>
                                        <Text style={statLabel}>Executions</Text>
                                    </td>
                                    <td style={{ textAlign: 'center', width: '25%' }}>
                                        <Text style={{ ...statValue, color: '#f87171' }}>{data.failedExecutions.toLocaleString()}</Text>
                                        <Text style={statLabel}>Errors</Text>
                                    </td>
                                    <td style={{ textAlign: 'center', width: '25%' }}>
                                        <Text style={{ ...statValue, color: data.errorRate > 10 ? '#f87171' : data.errorRate > 5 ? '#fbbf24' : '#34d399' }}>{data.errorRate}%</Text>
                                        <Text style={statLabel}>Error Rate</Text>
                                    </td>
                                    <td style={{ textAlign: 'center', width: '25%' }}>
                                        <Text style={{ ...statValue, color: '#a78bfa' }}>{data.diagnosed}</Text>
                                        <Text style={statLabel}>Diagnosed</Text>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </Section>

                    {/* Top Failing Workflows */}
                    {data.topFailingWorkflows.length > 0 && (
                        <Section style={card}>
                            <Text style={sectionTitle}>Top Failing Workflows</Text>
                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                <thead>
                                    <tr>
                                        <th style={tableHeader}>Workflow</th>
                                        <th style={{ ...tableHeader, textAlign: 'right' }}>Errors</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.topFailingWorkflows.map((wf, i) => (
                                        <tr key={i}>
                                            <td style={tableCell}>{wf.workflow_name}</td>
                                            <td style={tableCellRight}>
                                                <span style={badgeRed}>{wf.error_count}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>
                    )}

                    {/* Top Failing Nodes */}
                    {data.topFailingNodes.length > 0 && (
                        <Section style={card}>
                            <Text style={sectionTitle}>Top Failing Nodes</Text>
                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                <thead>
                                    <tr>
                                        <th style={tableHeader}>Node</th>
                                        <th style={{ ...tableHeader, textAlign: 'right' }}>Errors</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.topFailingNodes.map((n, i) => (
                                        <tr key={i}>
                                            <td style={{ ...tableCell, fontFamily: 'monospace', fontSize: '12px' }}>{n.error_node}</td>
                                            <td style={tableCellRight}>
                                                <span style={badgeAmber}>{n.error_count}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>
                    )}

                    {/* AI Diagnosis Stats */}
                    {data.diagnosed > 0 && (
                        <Section style={card}>
                            <Text style={sectionTitle}>AI Diagnosis</Text>
                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                <tbody>
                                    <tr>
                                        <td style={{ textAlign: 'center', width: '33%' }}>
                                            <Text style={{ ...statValue, fontSize: '22px', color: '#a78bfa' }}>{data.diagnosed}</Text>
                                            <Text style={statLabel}>Diagnosed</Text>
                                        </td>
                                        <td style={{ textAlign: 'center', width: '33%' }}>
                                            <Text style={{ ...statValue, fontSize: '22px', color: '#34d399' }}>{data.feedbackUp}</Text>
                                            <Text style={statLabel}>Thumbs Up</Text>
                                        </td>
                                        <td style={{ textAlign: 'center', width: '33%' }}>
                                            <Text style={{ ...statValue, fontSize: '22px', color: '#f87171' }}>{data.feedbackDown}</Text>
                                            <Text style={statLabel}>Thumbs Down</Text>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </Section>
                    )}

                    {/* Token Usage */}
                    {(data.totalTokensInput > 0 || data.totalTokensOutput > 0) && (
                        <Section style={card}>
                            <Text style={sectionTitle}>Token Usage</Text>
                            <Row>
                                <Column style={{ width: '50%' }}>
                                    <Text style={{ color: '#a1a1aa', fontSize: '11px', margin: '0' }}>Input Tokens</Text>
                                    <Text style={{ color: '#e4e4e7', fontSize: '16px', fontFamily: 'monospace', fontWeight: '600', margin: '2px 0 8px 0' }}>
                                        {data.totalTokensInput.toLocaleString()}
                                    </Text>
                                </Column>
                                <Column style={{ width: '50%' }}>
                                    <Text style={{ color: '#a1a1aa', fontSize: '11px', margin: '0' }}>Output Tokens</Text>
                                    <Text style={{ color: '#e4e4e7', fontSize: '16px', fontFamily: 'monospace', fontWeight: '600', margin: '2px 0 8px 0' }}>
                                        {data.totalTokensOutput.toLocaleString()}
                                    </Text>
                                </Column>
                            </Row>
                            {data.topModels.length > 0 && (
                                <>
                                    <Hr style={hr} />
                                    <Text style={{ color: '#a1a1aa', fontSize: '11px', margin: '0 0 8px 0' }}>Top Models</Text>
                                    {data.topModels.map((m, i) => (
                                        <Row key={i} style={{ marginBottom: '4px' }}>
                                            <Column style={{ width: '60%' }}>
                                                <Text style={{ color: '#e4e4e7', fontSize: '12px', fontFamily: 'monospace', margin: '2px 0' }}>{m.model}</Text>
                                            </Column>
                                            <Column style={{ width: '40%', textAlign: 'right' }}>
                                                <Text style={{ color: '#a1a1aa', fontSize: '12px', fontFamily: 'monospace', margin: '2px 0' }}>{m.total_tokens.toLocaleString()}</Text>
                                            </Column>
                                        </Row>
                                    ))}
                                </>
                            )}
                        </Section>
                    )}

                    {/* Instance Health */}
                    {data.instances.length > 0 && (
                        <Section style={card}>
                            <Text style={sectionTitle}>Instance Health</Text>
                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                <thead>
                                    <tr>
                                        <th style={tableHeader}>Instance</th>
                                        <th style={{ ...tableHeader, textAlign: 'center' }}>Status</th>
                                        <th style={{ ...tableHeader, textAlign: 'right' }}>Last Heartbeat</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.instances.map((inst, i) => (
                                        <tr key={i}>
                                            <td style={tableCell}>{inst.name}</td>
                                            <td style={{ ...tableCell, textAlign: 'center' }}>
                                                <span style={inst.status === 'healthy' ? badgeGreen : inst.status === 'degraded' ? badgeAmber : badgeRed}>
                                                    {inst.status}
                                                </span>
                                            </td>
                                            <td style={{ ...tableCellRight, fontSize: '11px' }}>
                                                {inst.last_heartbeat ? new Date(inst.last_heartbeat).toLocaleString() : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>
                    )}

                    {/* Alerts */}
                    {data.newAlerts.length > 0 && (
                        <Section style={card}>
                            <Text style={sectionTitle}>
                                Alerts
                                {data.activeAlerts > 0 && (
                                    <span style={{ ...badgeAmber, marginLeft: '8px', fontSize: '10px' }}>{data.activeAlerts} active</span>
                                )}
                            </Text>
                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                <tbody>
                                    {data.newAlerts.map((alert, i) => (
                                        <tr key={i}>
                                            <td style={{ ...tableCell, fontSize: '12px' }}>
                                                <span style={badgeViolet}>{alert.alert_type.replace(/_/g, ' ')}</span>
                                                <Text style={{ color: '#e4e4e7', fontSize: '12px', margin: '4px 0 0 0' }}>{alert.message}</Text>
                                                <Text style={{ color: '#71717a', fontSize: '10px', margin: '2px 0 0 0' }}>
                                                    {alert.instance_name} — {new Date(alert.triggered_at).toLocaleString()}
                                                </Text>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>
                    )}

                    {/* Per-Instance Breakdown */}
                    {data.instanceBreakdown && data.instanceBreakdown.length > 0 && (
                        <>
                            <Hr style={{ borderColor: '#3f3f46', margin: '28px 0 20px 0' }} />
                            <Section style={{ marginBottom: '16px' }}>
                                <Heading style={{ ...heading, fontSize: '18px' }}>Per-Instance Breakdown</Heading>
                                <Text style={{ ...subheading, margin: '0' }}>Detailed stats for each monitored n8n instance</Text>
                            </Section>

                            {data.instanceBreakdown.map((inst, idx) => (
                                <Section key={idx} style={{ ...card, borderLeft: `3px solid ${inst.status === 'healthy' ? '#34d399' : inst.status === 'degraded' ? '#fbbf24' : '#71717a'}` }}>
                                    {/* Instance Header */}
                                    <table width="100%" cellPadding={0} cellSpacing={0}>
                                        <tbody>
                                            <tr>
                                                <td>
                                                    <Text style={{ color: '#ffffff', fontSize: '15px', fontWeight: '600', margin: '0 0 2px 0' }}>
                                                        {inst.instance_name}
                                                    </Text>
                                                    <Text style={{ color: '#71717a', fontSize: '11px', margin: '0' }}>
                                                        <span style={inst.status === 'healthy' ? badgeGreen : inst.status === 'degraded' ? badgeAmber : { ...badgeRed, backgroundColor: 'rgba(113,113,122,0.1)', color: '#a1a1aa', border: '1px solid rgba(113,113,122,0.2)' }}>
                                                            {inst.status}
                                                        </span>
                                                        {inst.last_heartbeat && (
                                                            <span style={{ marginLeft: '8px', color: '#71717a' }}>
                                                                Last heartbeat: {new Date(inst.last_heartbeat).toLocaleString()}
                                                            </span>
                                                        )}
                                                    </Text>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    {/* Instance Stats Row */}
                                    <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: '12px' }}>
                                        <tbody>
                                            <tr>
                                                <td style={{ textAlign: 'center', width: '20%' }}>
                                                    <Text style={{ ...statValue, fontSize: '18px' }}>{inst.totalExecutions.toLocaleString()}</Text>
                                                    <Text style={statLabel}>Executions</Text>
                                                </td>
                                                <td style={{ textAlign: 'center', width: '20%' }}>
                                                    <Text style={{ ...statValue, fontSize: '18px', color: '#f87171' }}>{inst.failedExecutions.toLocaleString()}</Text>
                                                    <Text style={statLabel}>Errors</Text>
                                                </td>
                                                <td style={{ textAlign: 'center', width: '20%' }}>
                                                    <Text style={{ ...statValue, fontSize: '18px', color: inst.errorRate > 10 ? '#f87171' : inst.errorRate > 5 ? '#fbbf24' : '#34d399' }}>{inst.errorRate}%</Text>
                                                    <Text style={statLabel}>Error Rate</Text>
                                                </td>
                                                <td style={{ textAlign: 'center', width: '20%' }}>
                                                    <Text style={{ ...statValue, fontSize: '18px', color: '#a78bfa' }}>{inst.diagnosed}</Text>
                                                    <Text style={statLabel}>Diagnosed</Text>
                                                </td>
                                                <td style={{ textAlign: 'center', width: '20%' }}>
                                                    <Text style={{ ...statValue, fontSize: '18px', color: inst.activeAlerts > 0 ? '#fbbf24' : '#71717a' }}>{inst.activeAlerts}</Text>
                                                    <Text style={statLabel}>Alerts</Text>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>

                                    {/* Instance Token Usage */}
                                    {(inst.totalTokensInput > 0 || inst.totalTokensOutput > 0) && (
                                        <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: '8px' }}>
                                            <tbody>
                                                <tr>
                                                    <td style={{ padding: '4px 8px' }}>
                                                        <Text style={{ color: '#a1a1aa', fontSize: '10px', margin: '0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tokens</Text>
                                                        <Text style={{ color: '#e4e4e7', fontSize: '12px', fontFamily: 'monospace', margin: '2px 0 0 0' }}>
                                                            {inst.totalTokensInput.toLocaleString()} in / {inst.totalTokensOutput.toLocaleString()} out
                                                        </Text>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    )}

                                    {/* Instance Top Failing Workflows */}
                                    {inst.topFailingWorkflows.length > 0 && (
                                        <>
                                            <Hr style={{ ...hr, margin: '10px 0 8px 0' }} />
                                            <Text style={{ color: '#a1a1aa', fontSize: '10px', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Failing Workflows</Text>
                                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                                <tbody>
                                                    {inst.topFailingWorkflows.map((wf, i) => (
                                                        <tr key={i}>
                                                            <td style={{ color: '#e4e4e7', fontSize: '12px', padding: '3px 8px' }}>{wf.workflow_name}</td>
                                                            <td style={{ textAlign: 'right', padding: '3px 8px' }}>
                                                                <span style={{ ...badgeRed, fontSize: '10px' }}>{wf.error_count}</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </>
                                    )}

                                    {/* Instance Top Failing Nodes */}
                                    {inst.topFailingNodes.length > 0 && (
                                        <>
                                            <Text style={{ color: '#a1a1aa', fontSize: '10px', margin: '8px 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Failing Nodes</Text>
                                            <table width="100%" cellPadding={0} cellSpacing={0}>
                                                <tbody>
                                                    {inst.topFailingNodes.map((n, i) => (
                                                        <tr key={i}>
                                                            <td style={{ color: '#e4e4e7', fontSize: '11px', fontFamily: 'monospace', padding: '3px 8px' }}>{n.error_node}</td>
                                                            <td style={{ textAlign: 'right', padding: '3px 8px' }}>
                                                                <span style={{ ...badgeAmber, fontSize: '10px' }}>{n.error_count}</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </>
                                    )}

                                    {/* Instance Alerts */}
                                    {inst.newAlerts.length > 0 && (
                                        <>
                                            <Hr style={{ ...hr, margin: '10px 0 8px 0' }} />
                                            <Text style={{ color: '#a1a1aa', fontSize: '10px', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recent Alerts</Text>
                                            {inst.newAlerts.map((a, i) => (
                                                <Text key={i} style={{ color: '#e4e4e7', fontSize: '11px', margin: '2px 0 2px 8px' }}>
                                                    <span style={{ ...badgeViolet, fontSize: '9px', marginRight: '6px' }}>{a.alert_type.replace(/_/g, ' ')}</span>
                                                    {a.message}
                                                </Text>
                                            ))}
                                        </>
                                    )}
                                </Section>
                            ))}
                        </>
                    )}

                    {/* Footer */}
                    <Text style={footer}>
                        Sent by n8n Sentinel — {periodLabel} monitoring report
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

// ─── Render to HTML ──────────────────────────────────────────────────────────

export async function renderMonitoringReport(data: ReportData): Promise<string> {
    return await render(<MonitoringReport data={data} />);
}

export default MonitoringReport;
