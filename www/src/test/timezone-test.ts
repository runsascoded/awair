// Quick timezone conversion test to understand the issue

export function testTimezoneConversion() {
  // Example timestamp from the logs
  const sampleTimestamp = "2025-07-13T16:27:06.484000";

  console.log('=== TIMEZONE CONVERSION TEST ===');
  console.log('Original timestamp string:', sampleTimestamp);

  // How JavaScript currently interprets it (as local time)
  const asLocal = new Date(sampleTimestamp);
  console.log('Parsed as local:', asLocal.toString());
  console.log('Parsed as local (ISO):', asLocal.toISOString());

  // How we want to interpret it (as UTC, then convert to local)
  const asUTC = new Date(sampleTimestamp + 'Z');
  console.log('Parsed as UTC:', asUTC.toString());
  console.log('Parsed as UTC (ISO):', asUTC.toISOString());

  // What should the corrected local time be?
  // If the original was meant to be UTC, the local time should be UTC - offset
  const timezoneOffset = new Date().getTimezoneOffset(); // minutes
  console.log('Current timezone offset (minutes):', timezoneOffset);

  // Method 1: Convert UTC to local by subtracting offset
  const correctedLocal1 = new Date(asUTC.getTime() - (timezoneOffset * 60000));
  console.log('Method 1 - UTC to local:', correctedLocal1.toString());
  console.log('Method 1 - Local ISO:', correctedLocal1.toISOString().slice(0, 19));

  // Method 2: Just use the UTC time directly as local
  const correctedLocal2 = asUTC.toISOString().slice(0, 19);
  console.log('Method 2 - UTC ISO as local:', correctedLocal2);

  // Test with a known UTC time vs expected local time
  console.log('\n=== EXPECTED BEHAVIOR ===');
  console.log('If data timestamp is UTC 20:17 (8:17 PM)');
  console.log('Then local time should be UTC 20:17 → Local 16:17 (4:17 PM EDT)');

  const testUTC = "2025-07-13T20:17:00";
  const testUTCParsed = new Date(testUTC + 'Z');
  console.log('Test UTC parsed:', testUTCParsed.toString());

  // The local time should be 4 hours earlier in EDT
  const expectedLocal = new Date(testUTCParsed.getTime());
  console.log('Expected local time:', expectedLocal.toString());
  console.log('Expected local ISO:', expectedLocal.toISOString().slice(0, 19));
}

// Test function to fetch and analyze actual data
export async function testActualData() {
  console.log('\n=== ACTUAL DATA TEST ===');

  try {
    const response = await fetch('https://s3.amazonaws.com/380nwk/awair.parquet');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // We'd need to import hyparquet here, but let's keep it simple for now
    console.log('Successfully fetched parquet file, size:', arrayBuffer.byteLength);
    console.log('Would need hyparquet to parse and test actual timestamps');

  } catch (error) {
    console.error('Failed to fetch data:', error);
  }
}

// Run the test
if (typeof window !== 'undefined') {
  testTimezoneConversion();
  testActualData();
}