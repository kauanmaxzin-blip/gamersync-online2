GamerSync - Firebase Authentication

O app agora usa Firebase Authentication com Google.

No Firebase:
1. Crie um projeto.
2. Vá em Authentication > Sign-in method.
3. Ative Google.
4. Vá em Project settings > Your apps > Web app e copie a configuração web.
5. Vá em Project settings > Service accounts e gere uma private key JSON.

No Render > Environment:
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID
FIREBASE_SERVICE_ACCOUNT_BASE64

Para criar FIREBASE_SERVICE_ACCOUNT_BASE64:
- pegue o JSON da service account
- transforme em base64
- cole no Render

ADM por email:
No server.js, edite:

const ADMIN_EMAIL_CODES = {
  "seuemail@gmail.com": "adm123"
};

Substitua no GitHub:
- index.html
- server.js
- package.json
- render.yaml

Depois:
Commit changes
Render > Manual Deploy > Deploy latest commit
