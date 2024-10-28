# Apps Monitor

Esta ferramenta monitora os apps instalados em todas as instâncias de um cluster de Rocket.Chat, tentando manter os status habilitados quando há inconsistências. Caso uma intervenção manual do usuário seja necessária, uma mensagem de alerta é enviada a uma sala configurada previamente.

## Configuração

Para o funcionamento correto da ferramenta, é necessária a criação de um arquivo chamado `apps-monitor-config.json` no mesmo diretório onde se encontra o executável.

Segue abaixo um exemplo das configurações possíveis:

```
{
    "userPAT": "NonIfSuzWFzEPA2RB7slUGp-ubNtLGZy78aWwIWjWpt",
    "userId": "YzrFwYjd7qDAhArBZ",
    "serverURL": "http://172.19.0.5",
    "interval": 30000,
    "alertRoom": "671feba8af417d3edd6dbf30"
}
```

- `userPAT` - um token de acesso pessoal (PAT) de um usuário com permissões de administração do sistema. *É importante que seja selecionado um token que ignore autenticação por dois fatores (Ignore two factor authentication)* Para saber mais sobre como criar um PAT, [clique aqui](https://docs.rocket.chat/v1/docs/account#personal-access-tokens)
- `userId` - identificador do usuário que usará o PAT. Essa informação é fornecida durante a criação de um PAT.
- `serverURL` - A URL base de acesso ao servidor
- `interval` - Opcional. Determina o intervalo entre as checagens do monitor, em milisegundos. (valor default: 30000 (5 minutos))
- `alertRoom` - Opcional. O identificador de uma sala à qual o usuário tenha acesso para que sejam enviados avisos em caso de problemas. Para conseguir o identificador de uma sala, acesse o menu Salas em Administração e clique na sala desejada. O identificador da sala estará presente na barra de endereço do navegador utilizado (exemplo: `http://172.19.0.5/admin/rooms/edit/671feba8af417d3edd6dbf30`)

## Execução

Execute o arquivo executável pela linha de comando. Nenhuma opção de linha de commando é necessária

```sh
$ ./apps-monitor
```

A ferramenta utiliza o mesmo formato de logs que o Rocket.Chat. Caso o nível de logs padrão não seja suficiente, basta executar o monitor com a variável de ambiente `LOG_LEVEL=trace`

```sh
$ LOG_LEVEL=trace ./apps-monitor
```

### Acesso ao servidor Rocket.Chat

A ferramenta necessita de acesso via rede ao endereço configurado acima (`serverURL`) *e aos endereços de IP de cada instância presente no cluster* para funcionar corretamente.

## Código fonte

A nível de conferência, este pacote inclui o código fonte utilizado para gerar o executável, contido no arquivo `apps-monitor.ts`.

O arquivo executável foi gerado utilizando Deno, através do commando:

```sh
$ deno compile --allow-env --allow-read --allow-sys --allow-net apps-monitor.ts
```
