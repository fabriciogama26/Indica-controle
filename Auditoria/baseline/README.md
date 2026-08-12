# Capturas de baseline

Saída bruta de `scripts/perf-baseline-capture.sql`. Um arquivo por captura, nunca sobrescrever.

Convenção de nome:

```
AAAA-MM-DD-<marco>-<contexto>.txt

2026-08-14-T0-pico.txt              # dia útil de uso normal/alto
2026-08-29-T0-fechamento.txt        # fechamento de mês (janela que estoura o teto do dash-estoque)
2026-09-20-T1-pos-p2-1.txt          # depois da RPC de agregação do dash-estoque
```

Antes de comparar duas capturas, conferir no bloco `00` que **`contadores_desde` (`stats_reset`) é igual nas duas**. Se mudou, os contadores zeraram no meio e o diff é inválido — descartar e recapturar.

Não comparar números brutos entre capturas: `total_exec_time`, `calls` e `shared_blks_read` são proporcionais ao tráfego da janela. Usar as métricas por chamada e o custo por carregamento do dashboard — ver [`../07-baseline-p1.md`](../07-baseline-p1.md) §1.

Toda captura precisa terminar com o **denominador anotado à mão**, porque ele não sai do banco:

```
# denominador: <N> carregamentos de GET /api/dash-estoque
# fonte: <log da hospedagem>, <janela exata>
```

Sem isso a captura não serve para provar o ganho do P2.1 depois, e o número não é recuperável — a janela passa.

Runbook completo: [`../07-baseline-p1.md`](../07-baseline-p1.md).
