ROTINA NO CONTROLE — OPENROUTER

O que foi alterado
- Somente o Assistente e o Scanner foram trocados de Gemini para OpenRouter.
- A chave não fica mais dentro do HTML.
- O frontend usa /api/assistant, /api/scanner e /api/health.
- O modelo padrão é openrouter/free. O OpenRouter informa que há modelos gratuitos e que a conta gratuita não exige cartão; atualmente o limite é 50 requisições/dia e 20/min para modelos gratuitos.

COMO PUBLICAR NO RENDER
1. Suba estes arquivos no GitHub.
2. Crie um Web Service no Render apontando para o repositório.
3. Build Command: deixe vazio.
4. Start Command: npm start
5. Em Environment, crie OPENROUTER_API_KEY e cole a sua chave sk-or-v1-...
6. Opcional: crie PUBLIC_APP_URL com a URL do seu serviço.
7. Acesse a URL do Render. O app já será servido pelo server.js.

IMPORTANTE
A OpenRouter é gratuita para os modelos gratuitos, mas o aplicativo ainda precisa de uma chave API no servidor. A chave é criada na OpenRouter sem assinatura/cartão. Não coloque a chave dentro do index.html.

ENDPOINTS
GET  /api/health
POST /api/assistant
POST /api/scanner
