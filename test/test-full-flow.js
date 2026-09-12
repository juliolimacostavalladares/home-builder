const { spawn } = require('child_process');
const path = require('path');

async function testFullFlow() {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    'http://localhost:3000'
  ]);

  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch('http://127.0.0.1:9222/json');
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

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[BROWSER CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || a.description));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails?.text, msg.params.exceptionDetails?.exception?.description);
      }
    });

    await send('Runtime.enable');
    await send('DOM.enable');

    // Busca o file input
    const doc = await send('DOM.getDocument');
    const fileInputNode = await send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#fileInput'
    });

    console.log('FileInput nodeId:', fileInputNode.nodeId);
    const testFile = '/Users/macbookpro/Desktop/12_plantas_baixas_3_quartos/Planta_3_quartos-160m2.dwg';

    console.log('Enviando arquivo via CDP setFileInputFiles...');
    await send('DOM.setFileInputFiles', {
      files: [testFile],
      nodeId: fileInputNode.nodeId
    });

    // Aguarda o processamento
    console.log('Aguardando 4 segundos...');
    await new Promise(r => setTimeout(r, 4000));

    const state = await send('Runtime.evaluate', {
      expression: `({
        selectedFile: selectedFile ? selectedFile.name : null,
        currentFloorplanData: !!currentFloorplanData,
        roomsCount: currentFloorplanData?.rooms?.length || 0,
        wallsCount: currentFloorplanData?.walls?.length || 0,
        volumetricsCardDisplay: document.getElementById('volumetricsCard')?.style.display,
        emptyStateDisplay: document.getElementById('threeEmptyState')?.style.display,
        toastText: document.getElementById('toast')?.textContent,
        toastDisplay: document.getElementById('toast')?.style.display
      })`,
      returnByValue: true
    });

    console.log('RESULTADO FINAL DO NAVEGADOR:', state.result.value);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    chrome.kill();
  }
}

testFullFlow();
