# Arquitetura e Otimizacao Conservadora

Esta aplicacao adota uma arquitetura em tres camadas para equilibrar separacao de responsabilidades e simplicidade. O frontend Next.js consome a API Django REST, enquanto o backend organiza as responsabilidades em **API**, **Service/Domain** e **Infrastructure**. Essa divisao evita complexidade excessiva e mantem as regras principais fora das views.

## Camadas

- **API**: ViewSets, serializers/DTOs, permissoes, paginacao e respostas HTTP.
- **Service/Domain**: regras de negocio e casos de uso, como movimentacao patrimonial, auditoria, classificacao RFID e tratamento de inconsistencias.
- **Infrastructure**: persistencia com Django ORM, migrations, banco de dados, comunicacao HTTP com antenas e integracao com o comunicador RFID.

No contexto do Django REST, a camada API cumpre o papel de controller: recebe requisicoes, valida os dados, aciona os servicos de dominio e retorna respostas HTTP.

## Organizacao de pastas

```text
backend/core/
|-- api/              # API, controllers, serializers/DTOs e permissoes
|-- domain/           # Services, regras de negocio e casos de uso
|-- infrastructure/   # Integracoes RFID/HTTP e infraestrutura operacional
`-- migrations/       # Historico de alteracoes do banco

scripts/rfid/
`-- comunicador_intermediario.py
```

Essa organizacao reduz a poluicao da raiz do projeto e aproxima o codigo da arquitetura em tres camadas. O pacote `api` concentra a comunicacao HTTP, `domain` concentra as regras do inventario RFID, e `infrastructure` agrupa detalhes externos, como comunicacao com antenas e suporte operacional.

## Injecao de dependencias

O `RFIDEventProcessor` aceita dependencias pelo construtor. Essa abordagem dispensa frameworks externos e permite substituir servicos reais por objetos falsos durante os testes. Com isso, o sistema fica menos acoplado e mais facil de validar.

## DTOs

Os serializers do Django REST exercem o papel de DTOs dentro da camada API. Eles isolam os dados recebidos pela API dos models internos, centralizam validacoes e reduzem duplicacao entre frontend e backend. DTOs nao foram tratados como uma camada propria para manter a arquitetura objetiva.

## Otimizacao

Foram adicionados indices nos dados mais consultados: leituras RFID, timeline, inconsistencias e estado das antenas. Essa escolha melhora consultas frequentes de auditoria e monitoramento sem alterar os endpoints nem aumentar a complexidade da aplicacao.

## Ganho tecnico

As melhorias aumentam manutenibilidade, testabilidade e escalabilidade gradual. A aplicacao continua simples, mas passa a evidenciar boas praticas de engenharia de software adequadas a um sistema RFID academico e operacional.

## Texto base para o TCC

A aplicacao foi organizada em tres camadas principais para equilibrar separacao de responsabilidades e simplicidade. A camada **API** expoe os endpoints REST, valida dados por meio de serializers/DTOs e controla as respostas HTTP. A camada **Service/Domain** concentra as regras de negocio do inventario RFID, como movimentacao patrimonial, auditoria e tratamento de inconsistencias. A camada **Infrastructure** reune os mecanismos de persistencia e comunicacao externa, como banco de dados, ORM, migrations e integracao com leitores RFID.
