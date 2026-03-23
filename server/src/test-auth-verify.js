// using native fetch

const API_BASE = 'http://localhost:3000/api';
const PASSWORD = 'admin'; // As set in middleware/session.ts default

async function testAuth() {
    console.log('--- Starting Auth Verification ---');

    // 1. Unauthenticated Request
    console.log('\nNO TOKEN: Fetching /api/instances...');
    const res1 = await fetch(`${API_BASE}/instances`);
    console.log(`Status: ${res1.status} (Expected 401)`);
    if (res1.status !== 401) throw new Error('Failed: Should be 401');

    // 2. Login (Wrong Password)
    console.log('\nLOGIN: Sending wrong password...');
    const res2 = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' })
    });
    console.log(`Status: ${res2.status} (Expected 401)`);
    if (res2.status !== 401) throw new Error('Failed: Should be 401');

    // 3. Login (Correct Password)
    console.log('\nLOGIN: Sending correct password...');
    const res3 = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD })
    });
    const data3 = await res3.json();
    console.log(`Status: ${res3.status} (Expected 200)`);
    if (res3.status !== 200) throw new Error('Failed: Login failed');
    if (!data3.token) throw new Error('Failed: No token returned');
    console.log('Token received.');

    // 4. Authenticated Request
    console.log('\nWITH TOKEN: Fetching /api/instances...');
    const res4 = await fetch(`${API_BASE}/instances`, {
        headers: { 'Authorization': `Bearer ${data3.token}` }
    });
    console.log(`Status: ${res4.status} (Expected 200)`);
    if (res4.status !== 200) throw new Error('Failed: Should be 200');

    const instances = await res4.json();
    console.log(`Success! Retrieved ${instances.length} instances.`);
}

testAuth().catch(err => {
    console.error('VERIFICATION FAILED:', err.message);
    process.exit(1);
});
