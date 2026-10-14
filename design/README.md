# Proposta visual — cômodos 3D

Prévia do próximo fluxo do Home Control. O aplicativo real continua com suas integrações LG e Tuya funcionando como antes.

Abra [room-3d-concept.html](room-3d-concept.html) em um navegador. A prévia usa Three.js por CDN e precisa de internet para carregar. Se o navegador restringir módulos em arquivos locais, sirva a pasta pelo servidor de desenvolvimento já disponível no projeto.

Explore a maquete, clique em um aparelho para abrir seu modal e experimente os controles simulados. O modo de edição demonstra o posicionamento de objetos. Nenhuma ação acessa suas contas ou controla aparelhos físicos.

O [plano de implementação](../docs/PLANO-EXPERIENCIA-CASA.md) descreve o escopo, a arquitetura, os critérios de entrega e a ordem **cômodos 3D → grupos → cenas e automações**. A implementação final empacotará os recursos gráficos localmente no Electron.

Capturas: [maquete](room-3d-preview.png) e [modal do aparelho](room-3d-modal.png).

Verificado no Chromium: carregamento 3D sem erros de console, abertura dos controles, mudança de cor, adição de aparelho no piso, criação/troca de cômodo e ausência de rolagem horizontal em 940 × 640. Os dados da demonstração são reiniciados ao recarregar.
