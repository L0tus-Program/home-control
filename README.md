# Home Control

Central de automação da casa em Electron. Hoje fala com o ar-condicionado LG pela API
oficial ThinQ Connect. As lâmpadas Elgin entram em seguida.

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

Outros comandos: `npm run typecheck`, `npm run build`, `npm run dist` (instalador Windows).

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
    store.ts              configuração + token no cofre do sistema
    ipc.ts                handlers; toda chamada volta como Result<T>
  preload/index.ts        a única superfície que o renderer enxerga
  renderer/               React: cards, mostrador de temperatura, preferências
```

A UI nunca fala ThinQ. Ela consome `Device` + `Capability[]` e manda `Command`. Um
aparelho desenha os controles que as capabilities dele declaram — por isso o card do ar
mostra exatamente os modos que o **seu** modelo aceita, lidos do perfil, e não uma lista
chumbada.

### Somando a Elgin

1. `src/main/drivers/elgin/driver.ts` implementando `Driver`.
2. Uma linha em `registry.ts`.

Nem o IPC nem a UI mudam. As capabilities `brightness` e `color` já estão no modelo
esperando. As lâmpadas Elgin são Tuya por baixo, então o driver vai falar o protocolo
Tuya, não ThinQ.

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
