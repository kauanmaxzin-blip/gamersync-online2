GamerSync Online - Servidor para todos entrarem

Esse projeto cria um servidor real para o app GamerSync.
Depois de publicar online, qualquer pessoa com o link pode entrar e conversar.

O que já vem pronto:
- App visual dentro da pasta public
- Servidor Node.js em server.js
- Chat em tempo real com Socket.IO
- Salas públicas e privadas
- Lista de jogadores online
- Limite de 5 jogadores por sala
- Configuração render.yaml para publicar no Render

Como publicar para virar um link público:

1. Extraia este ZIP.
2. Envie a pasta gamersync_online_pronto para um repositório no GitHub.
3. Entre no Render.
4. Clique em New > Web Service.
5. Conecte o repositório do GitHub.
6. Use:
   Build Command: npm install
   Start Command: npm start
7. Clique em Create Web Service.
8. Quando terminar, o Render vai mostrar um link parecido com:
   https://gamersync-online.onrender.com

Pronto.
Agora é só mandar esse link para os amigos.
Todos entram pelo navegador e conversam na mesma sala.

Teste:
- Abra o link em dois celulares ou duas abas.
- Crie conta/entre no app.
- Escolha o mesmo jogo.
- Entre em uma sala.
- Envie mensagem.

Observação:
As mensagens e salas ficam ativas enquanto o servidor estiver rodando.
Esta versão não usa banco de dados ainda.
