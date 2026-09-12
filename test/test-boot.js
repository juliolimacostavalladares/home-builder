const { spawn } = require('child_process');
const fs = require('fs');

async function testBoot() {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9224',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch('http://127.0.0.1:9224/json');
    const tabs = await res.json();
    const appTab = tabs.find(t => t.url.includes('3000'));
    if (!appTab) {
      console.log('App tab not found');
      return;
    }

    const ws = new globalThis.WebSocket(appTab.webSocketDebuggerUrl);
    await new Promise(resolve => ws.onopen = resolve);

    let msgId = 1;
    function send(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve) => {
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', handler);
            resolve(data.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Runtime.enable');
    await send('Page.enable');

    // Wait 3.5 seconds for sample to auto-load on boot
    await new Promise(r => setTimeout(r, 3500));

    const state = await send('Runtime.evaluate', {
      expression: `({
        currentFloorplanData: !!currentFloorplanData,
        roomsCount: currentFloorplanData?.rooms?.length || 0,
        wallsCount: currentFloorplanData?.walls?.length || 0,
        volumetricsCardDisplay: document.getElementById('volumetricsCard')?.style.display,
        emptyStateDisplay: document.getElementById('threeEmptyState')?.style.display,
        threeSceneObjects: threeScene ? threeScene.children.length : 0,
        canvasWidth: threeRenderer ? threeRenderer.domElement.width : 0,
        canvasHeight: threeRenderer ? threeRenderer.domElement.height : 0
      })`,
      returnByValue: true
    });

    console.log('BOOT STATE (ZERO CLICKS):', state.result.value);

    // Take screenshot
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('test/boot-screenshot.png', Buffer.from(screenshot.data, 'base64'));
    console.log('Screenshot saved to test/boot-screenshot.png');

  } catch (err) {
    console.error('Error in testBoot:', err);
  } finally {
    chrome.kill();
  }
}

testBoot();
