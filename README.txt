GamerSync - Sincronização de salas

Mudanças:
- quem entra depois agora recebe as salas que já estavam abertas
- o servidor manda a lista de salas assim que o jogador conecta
- o app atualiza a lista ao entrar com Google
- o app atualiza a lista ao abrir um jogo
- o app sincroniza as salas automaticamente a cada 4 segundos

Observação:
A sala aparece para quem entra depois enquanto ela ainda existir no servidor.
Se todos saírem da sala, ela é fechada e some da lista.

Substitua no GitHub:
- index.html
- server.js
- package.json
- render.yaml

Depois:
Commit changes
Render > Save, rebuild, and deploy
