GamerSync - ADM sem código

Mudanças:
- removido o campo Código de ADM
- ADM agora é automático pelo Gmail escolhido
- quem não é ADM não vê a Área de ADM no perfil
- quem é ADM vê o botão Abrir Painel ADM
- ADM pode fechar salas pelo painel

Como escolher ADM:
Abra server.js e edite esta parte:

const ADMIN_EMAILS = [
  "kauanmaxzin@gmail.com"
];

Coloque o Gmail real de cada ADM dentro da lista.

Substitua no GitHub:
- index.html
- server.js
- package.json
- render.yaml

Depois:
Commit changes
Render > Save, rebuild, and deploy
