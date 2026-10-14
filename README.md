# Home Control

Central de automação da casa em Electron. Hoje fala com o ar-condicionado LG pela API
oficial ThinQ Connect e com lâmpadas pela conexão oficial Tuya com Código de Usuário e QR Code. Cada integração tem
sua própria tela de aparelhos e preferências, acessível pela barra lateral.

![status](https://img.shields.io/badge/estado-funcionando-success)

## Rodando

```bash
npm install
npm run dev
```

Se o Electron reclamar de `Electron uninstall`, o binário não baixou no `npm install`:

```bash
node node_modules/electron/install.js
```

Outros comandos: `npm test`, `npm run typecheck`, `npm run build`, `npm run dist` (instalador Windows).

## Conectando a conta LG

O ponto que custa a achar: **o portal de token é coreano e o login por ID/senha não
aceita conta de fora da Coreia.** O caminho que funciona é o QR code.

1. Abra <https://connect-pat.lgthinq.com>. A página carrega em coreano — é esperado.
2. Ignore o formulário de ID/senha. Use o **login por QR code** (o link logo abaixo do
   botão) e leia o código com o app ThinQ do celular.
3. `CREATE NEW TOKEN`, marque os escopos, copie o token. A LG mostra ele uma vez só.
4. Cole em Preferências, junto com o país da conta (`BR`).

O token é guardado pelo `safeStorage` do Electron — DPAPI no Windows. Se o cofre do
sistema não estiver disponível, o app recusa salvar em vez de gravar em texto puro.

### O que não funciona

- `thinq.developer.lge.com` — não existe, não resolve.
- `smartsolution.developer.lge.com` — é a ThinQ **Business** API, outro produto.
- Login por ID/senha no portal de PAT, com conta brasileira.

## Arquitetura

```
src/
  shared/types.ts         modelo de aparelho comum a todas as integrações
  main/
    drivers/
      types.ts            a interface Driver
      registry.ts         monta os drivers a partir da configuração
      thinq/client.ts     REST da ThinQ Connect (headers, regiões, erros)
      thinq/driver.ts     perfil e estado do aparelho → modelo comum
      tuya/login.ts       autorização por Código de Usuário e QR Code
      tuya/sharing.ts     transporte e sessão do protocolo público Tuya
      tuya/cloud.ts       suporte legado a projetos OpenAPI
      tuya/driver.ts      descoberta e comandos das lâmpadas
      tuya/bulb.ts        funções e estado Tuya → capabilities comuns
    store.ts              configuração + credenciais criptografadas no sistema
    ipc.ts                handlers; toda chamada volta como Result<T>
  preload/index.ts        a única superfície que o renderer enxerga
  renderer/               React: cards, mostrador de temperatura, preferências
```

A UI nunca fala ThinQ. Ela consome `Device` + `Capability[]` e manda `Command`. Um
aparelho desenha os controles que as capabilities dele declaram — por isso o card do ar
mostra exatamente os modos que o **seu** modelo aceita, lidos do perfil, e não uma lista
chumbada.

## Conectando a Tuya

Selecione **Tuya** na barra lateral e clique em **Conectar Tuya**.

1. No app **Tuya Smart** ou **Smart Life**, abra **Eu → Configurações → Conta e
   segurança → Código de Usuário** e copie o código.
2. Cole no Home Control e clique em **Gerar QR Code**.
3. No app, toque em **+ → Escanear**, leia o QR Code da tela e confirme a autorização.
   O Home Control reconhece a confirmação e carrega suas lâmpadas automaticamente.

A autorização pode aparecer como **Home Assistant** no app, pois o Home Control usa o
mesmo protocolo público de conexão. O código e o QR substituem o cadastro de projeto
cloud, chaves de desenvolvedor, datacenter, IP e chave local.

Se o QR Code expirar, clique em **Gerar novo QR Code**. Fechar a janela de conexão
cancela a tentativa. Se já autorizou no app, **Já confirmei no celular** verifica na hora.
Depois de conectado, use **Preferências Tuya** para reconectar ou
desconectar a conta. A conexão LG fica separada, com seu token preservado.

O fluxo requer **Tuya Smart** ou **Smart Life**. Apps de fabricantes, como Elgin,
podem não oferecer o Código de Usuário ou aceitar esta autorização. Nesse caso, cadastre
os aparelhos em um dos apps compatíveis antes de conectar.

As lâmpadas mostram somente os controles oferecidos pelo aparelho: ligar/desligar,
brilho e cor, quando disponíveis. Os tokens de acesso ficam criptografados com o
`safeStorage` do Electron, assim como o token LG.

Se a lista vier vazia, confira se as lâmpadas aparecem na conta do app que foi
autorizada e tente reconectar. Não é necessário cadastrar aparelhos manualmente.

Referência: [integração Tuya no Home Assistant](https://www.home-assistant.io/integrations/tuya/).

## Notas de implementação

Os endpoints, cabeçalhos e o formato dos payloads de controle foram conferidos contra o
SDK oficial `thinqconnect` (Apache-2.0) rodando em modo mock, não deduzidos da
documentação — que é incompleta nessa parte. O formato real:

```json
{ "operation":      { "airConOperationMode": "POWER_ON" } }
{ "airConJobMode":  { "currentJobMode": "COOL" } }
{ "airFlow":        { "windStrength": "HIGH" } }
{ "temperatureInUnits": { "targetTemperature": 23, "unit": "C" } }
```

Detalhe que morde: o alvo de temperatura muda de nome conforme o modo
(`coolTargetTemperature`, `heatTargetTemperature`, `autoTargetTemperature`) e o nome do
recurso varia entre `temperatureInUnits` e `temperature` conforme a geração do aparelho.
O driver lê o perfil e resolve os dois em tempo de execução.

Os comandos vão em série e o perfil fica em cache: a LG limita chamadas por minuto e
derruba quem abusa.
