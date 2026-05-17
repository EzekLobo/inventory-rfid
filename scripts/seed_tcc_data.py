# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import sys
from datetime import timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "inventario_rfid.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db import transaction  # noqa: E402
from django.utils import timezone  # noqa: E402

from core.domain.models import (  # noqa: E402
    AntenaRFID,
    AuditoriaJob,
    AuditoriaLeitorStatus,
    ItemPatrimonial,
    LeituraRFID,
    Local,
    NotificacaoInconsistencia,
    TimelineEvento,
)


DEMO_LOCAL_CODES = {"COL-01", "LAB-4A", "SAL-1245"}
def main() -> None:
    now = timezone.now()
    User = get_user_model()
    admin_user = (
        User.objects.filter(is_superuser=True).order_by("id").first()
        or User.objects.filter(is_staff=True).order_by("id").first()
        or User.objects.order_by("id").first()
    )

    with transaction.atomic():
        print("Limpando leituras, eventos e dados de teste antigos...")
        LeituraRFID.objects.all().delete()
        TimelineEvento.objects.all().delete()
        NotificacaoInconsistencia.objects.all().delete()
        AuditoriaLeitorStatus.objects.all().delete()
        AuditoriaJob.objects.all().delete()
        ItemPatrimonial.objects.all().delete()

        locais = create_locations()
        antenas = create_readers(locais, now)
        remove_unused_demo_readers(antenas)
        remove_unused_demo_locations()

        itens = create_items(locais, admin_user)
        create_readings(antenas, locais, itens, now)
        create_timeline(antenas, locais, itens, admin_user, now)
        create_audits_and_inconsistencies(antenas, locais, itens, admin_user, now)

    print("Base de demonstração para o TCC criada com sucesso.")
    print(f"Locais: {Local.objects.count()}")
    print(f"Leitores: {AntenaRFID.objects.count()}")
    print(f"Itens ativos: {ItemPatrimonial.objects.filter(ativo=True).count()}")
    print(f"Leituras RFID: {LeituraRFID.objects.count()}")
    print(f"Eventos no log: {TimelineEvento.objects.count()}")
    print(f"Inconsistências abertas: {NotificacaoInconsistencia.objects.filter(resolvida=False).count()}")


def create_locations() -> dict[str, Local]:
    specs = {
        "colegiado": ("COL-01", "Colegiado"),
        "lab": ("LAB-4A", "Laboratório 4A"),
        "sala": ("SAL-1245", "Sala 1245"),
    }
    locais = {}
    for key, (codigo, nome) in specs.items():
        local, _ = Local.objects.update_or_create(codigo=codigo, defaults={"nome": nome})
        locais[key] = local
    return locais


def create_readers(locais: dict[str, Local], now) -> dict[str, AntenaRFID]:
    proximity = (
        AntenaRFID.objects.filter(tipo=AntenaRFID.TipoAntena.FLUXO).order_by("id").first()
        or AntenaRFID.objects.filter(hardware_id__icontains="PROX").order_by("id").first()
    )
    proximity_defaults = {
        "nome": "Leitor de Proximidade - Porta do Colegiado",
        "hardware_id": proximity.hardware_id if proximity else "R-COL-01",
        "local": locais["colegiado"],
        "tipo": AntenaRFID.TipoAntena.FLUXO,
        "online": True,
        "ativa": False,
        "ultimo_ping": now - timedelta(seconds=8),
        "duracao_padrao_segundos": 5,
    }
    if proximity:
        for field, value in proximity_defaults.items():
            setattr(proximity, field, value)
        proximity.save()
    else:
        proximity = AntenaRFID.objects.create(**proximity_defaults)

    lab_reader, _ = AntenaRFID.objects.update_or_create(
        hardware_id="R-LAB-4A-01",
        defaults={
            "nome": "Leitor Fixo - Laboratório 4A",
            "local": locais["lab"],
            "tipo": AntenaRFID.TipoAntena.DESTINO,
            "online": True,
            "ativa": False,
            "ultimo_ping": now - timedelta(seconds=11),
            "duracao_padrao_segundos": 30,
        },
    )
    room_reader, _ = AntenaRFID.objects.update_or_create(
        hardware_id="R-SAL-1245-01",
        defaults={
            "nome": "Leitor Fixo - Sala 1245",
            "local": locais["sala"],
            "tipo": AntenaRFID.TipoAntena.DESTINO,
            "online": True,
            "ativa": False,
            "ultimo_ping": now - timedelta(seconds=6),
            "duracao_padrao_segundos": 30,
        },
    )
    return {"proximity": proximity, "lab": lab_reader, "sala": room_reader}


def remove_unused_demo_readers(antenas: dict[str, AntenaRFID]) -> None:
    keep_ids = [antena.id for antena in antenas.values()]
    AntenaRFID.objects.exclude(id__in=keep_ids).delete()


def remove_unused_demo_locations() -> None:
    for local in Local.objects.exclude(codigo__in=DEMO_LOCAL_CODES):
        if not local.antenas.exists():
            local.delete()


def create_items(locais: dict[str, Local], admin_user) -> dict[str, ItemPatrimonial]:
    specs = [
        ("notebook_coordenacao", "Notebook Dell Latitude 5420", "E20042000000000000000101", "colegiado", "colegiado", True),
        ("impressora", "Impressora HP LaserJet Pro", "E20042000000000000000102", "colegiado", "colegiado", True),
        ("projetor", "Projetor Epson PowerLite X49", "E20042000000000000000201", "lab", "sala", True),
        ("osciloscopio", "Osciloscópio Tektronix TBS1102B", "E20042000000000000000202", "lab", "lab", True),
        ("kit_arduino", "Kit de prototipagem Arduino", "E20042000000000000000203", "lab", "lab", True),
        ("desktop", "Desktop Lenovo ThinkCentre", "E20042000000000000000301", "sala", "sala", True),
        ("cadeira", "Cadeira ergonômica Flexform", "E20042000000000000000302", "sala", "sala", True),
        ("switch", "Switch TP-Link 24 portas", "E20042000000000000000303", "sala", "sala", True),
        ("monitor_baixado", "Monitor LG 22 polegadas", "E20042000000000000000401", "lab", "lab", False),
    ]
    itens = {}
    for key, nome, tag_id, logical_key, physical_key, active in specs:
        itens[key] = ItemPatrimonial.objects.create(
            tag_id=tag_id,
            nome=nome,
            local_logico=locais[logical_key],
            local_fisico=locais[physical_key],
            responsavel=admin_user,
            ativo=active,
        )
    return itens


def create_readings(antenas, locais, itens, now) -> None:
    reading_specs = [
        (-125, "notebook_coordenacao", "colegiado", "proximity", LeituraRFID.ClassificacaoLeitura.FLUXO, {"source": "demo_tcc", "evento": "flow_trace"}),
        (-118, "impressora", "colegiado", "proximity", LeituraRFID.ClassificacaoLeitura.FLUXO, {"source": "demo_tcc", "evento": "flow_trace"}),
        (-74, "osciloscopio", "lab", "lab", LeituraRFID.ClassificacaoLeitura.DESTINO, {"source": "demo_tcc", "audit_reading": True}),
        (-72, "kit_arduino", "lab", "lab", LeituraRFID.ClassificacaoLeitura.DESTINO, {"source": "demo_tcc", "audit_reading": True}),
        (-64, "desktop", "sala", "sala", LeituraRFID.ClassificacaoLeitura.DESTINO, {"source": "demo_tcc", "audit_reading": True}),
        (-63, "projetor", "sala", "sala", LeituraRFID.ClassificacaoLeitura.DESTINO, {"source": "demo_tcc", "audit_reading": True}),
    ]
    for minutes, item_key, local_key, antenna_key, classification, payload in reading_specs:
        leitura = LeituraRFID.objects.create(
            item=itens[item_key],
            tag_id=itens[item_key].tag_id,
            local=locais[local_key],
            antena=antenas[antenna_key],
            classificacao=classification,
            payload=payload,
        )
        set_created(leitura, now + timedelta(minutes=minutes))


def create_timeline(antenas, locais, itens, admin_user, now) -> None:
    event_specs = [
        (-150, "sistema", None, "Base patrimonial revisada para auditoria do TCC.", {"evento": "seed_tcc", "source": "demo_tcc"}),
        (-132, "sistema", "notebook_coordenacao", "Notebook Dell Latitude 5420 cadastrado no Colegiado.", {"evento": "cadastro_item", "local_nome": locais["colegiado"].nome}),
        (-128, "sistema", "projetor", "Projetor Epson PowerLite X49 cadastrado para o Laboratório 4A.", {"evento": "cadastro_item", "local_nome": locais["lab"].nome}),
        (-125, "rastro", "notebook_coordenacao", "Rastro RFID detectado na porta do Colegiado.", {"evento": "flow_trace", "tag_id": itens["notebook_coordenacao"].tag_id, "local_id": locais["colegiado"].id, "local_nome": locais["colegiado"].nome, "antenna_id": antenas["proximity"].id, "antenna_nome": antenas["proximity"].nome}),
        (-118, "rastro", "impressora", "Rastro RFID detectado na porta do Colegiado.", {"evento": "flow_trace", "tag_id": itens["impressora"].tag_id, "local_id": locais["colegiado"].id, "local_nome": locais["colegiado"].nome, "antenna_id": antenas["proximity"].id, "antenna_nome": antenas["proximity"].nome}),
        (-92, "movimentacao", "projetor", "Projetor emprestado temporariamente para apresentação na Sala 1245.", {"evento": "tags_read", "tag_id": itens["projetor"].tag_id, "local_anterior_id": locais["lab"].id, "local_id": locais["sala"].id, "local_nome": locais["sala"].nome, "antenna_id": antenas["sala"].id, "antenna_nome": antenas["sala"].nome}),
        (-84, "baixa", "monitor_baixado", "Monitor LG 22 polegadas marcado como inativo. Motivo: substituído por equipamento novo.", {"evento": "baixa_manual", "motivo": "substituição por equipamento novo", "tag_id": itens["monitor_baixado"].tag_id}),
    ]
    for minutes, tipo, item_key, mensagem, metadata in event_specs:
        evento = TimelineEvento.objects.create(
            item=itens[item_key] if item_key else None,
            tipo=tipo,
            mensagem=mensagem,
            usuario=admin_user,
            metadados=metadata,
        )
        set_created(evento, now + timedelta(minutes=minutes))


def create_audits_and_inconsistencies(antenas, locais, itens, admin_user, now) -> None:
    lab_job = create_job(admin_user, now - timedelta(minutes=78), now - timedelta(minutes=77, seconds=30), antenas["lab"])
    sala_job = create_job(admin_user, now - timedelta(minutes=66), now - timedelta(minutes=65, seconds=30), antenas["sala"])

    create_audit_summary(
        job=lab_job,
        antena=antenas["lab"],
        local=locais["lab"],
        when=now - timedelta(minutes=77),
        expected=[itens["projetor"], itens["osciloscopio"], itens["kit_arduino"]],
        found=[itens["osciloscopio"], itens["kit_arduino"]],
        missing=[itens["projetor"]],
        divergent=[],
        unknown_tags=[],
    )
    create_audit_summary(
        job=sala_job,
        antena=antenas["sala"],
        local=locais["sala"],
        when=now - timedelta(minutes=65),
        expected=[itens["desktop"], itens["cadeira"], itens["switch"]],
        found=[itens["desktop"], itens["switch"]],
        missing=[itens["cadeira"]],
        divergent=[itens["projetor"]],
        unknown_tags=["E20042000000000000000999"],
    )

    inconsistency_specs = [
        (lab_job, "projetor", NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO, locais["lab"], locais["sala"], False, "item_nao_encontrado"),
        (sala_job, "projetor", NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE, locais["lab"], locais["sala"], False, "item_fora_do_local_auditado"),
        (sala_job, "cadeira", NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO, locais["sala"], locais["sala"], False, "item_nao_encontrado"),
        (sala_job, None, NotificacaoInconsistencia.TipoInconsistencia.TAG_DESCONHECIDA, None, locais["sala"], False, "tag_desconhecida"),
        (lab_job, "kit_arduino", NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE, locais["sala"], locais["lab"], True, "local_divergente"),
    ]
    for job, item_key, tipo, logical, physical, resolved, event_name in inconsistency_specs:
        tag_id = "E20042000000000000000999" if item_key is None else itens[item_key].tag_id
        item = itens[item_key] if item_key else None
        inconsistencia = NotificacaoInconsistencia.objects.create(
            item=item,
            tipo=tipo,
            tag_id=tag_id,
            local_logico=logical,
            local_fisico=physical,
            resolvida=resolved,
            resolvida_em=now - timedelta(minutes=58) if resolved else None,
            metadados=audit_metadata(job, physical or logical, antenas["sala"] if job == sala_job else antenas["lab"], event_name, tag_id),
        )
        set_created(inconsistencia, now - timedelta(minutes=64 if job == sala_job else 76))
        create_inconsistency_event(inconsistencia, item, admin_user, now - timedelta(minutes=64 if job == sala_job else 76))

    resolved_event = TimelineEvento.objects.create(
        item=itens["kit_arduino"],
        tipo=TimelineEvento.TipoEvento.SISTEMA,
        mensagem="Divergência do Kit de prototipagem Arduino resolvida após conferência manual.",
        usuario=admin_user,
        metadados={"evento": "inconsistencia_resolvida", "motivo": "conferência manual no Laboratório 4A"},
    )
    set_created(resolved_event, now - timedelta(minutes=58))


def create_job(admin_user, started_at, finished_at, antena) -> AuditoriaJob:
    job = AuditoriaJob.objects.create(
        solicitado_por=admin_user,
        duracao_segundos=30,
        status=AuditoriaJob.Status.CONCLUIDO,
        finaliza_em=finished_at,
        concluido_em=finished_at,
    )
    set_started(job, started_at)
    AuditoriaLeitorStatus.objects.create(job=job, antena=antena, status=AuditoriaLeitorStatus.Status.ENCERRADO)
    return job


def create_audit_summary(*, job, antena, local, when, expected, found, missing, divergent, unknown_tags) -> None:
    evento = TimelineEvento.objects.create(
        item=None,
        tipo=TimelineEvento.TipoEvento.SISTEMA,
        mensagem=f"Auditoria realizada em {local.nome} pela antena {antena.nome}.",
        usuario=job.solicitado_por,
        metadados={
            "evento": "auditoria_processada",
            "audit": True,
            "auditoria_job_id": job.id,
            "auditoria_execucao_id": f"job-{job.id}",
            "auditoria_criada_em": when.isoformat(),
            "antenna_id": antena.id,
            "antenna_nome": antena.nome,
            "local_id": local.id,
            "local_nome": local.nome,
            "esperados": len(expected),
            "encontrados": len(found),
            "nao_encontrados": len(missing),
            "tags_desconhecidas": len(unknown_tags),
            "tags_fora_do_local": len(divergent),
            "total_lidos": len(found) + len(divergent) + len(unknown_tags),
            "itens_esperados": [audit_item(item) for item in expected],
            "itens_encontrados": [audit_item(item) for item in found],
            "itens_nao_encontrados": [audit_item(item) for item in missing],
            "itens_divergentes": [audit_item(item) for item in divergent],
            "tags_desconhecidas_lista": unknown_tags,
        },
    )
    set_created(evento, when)


def create_inconsistency_event(inconsistencia, item, admin_user, when) -> None:
    if inconsistencia.tipo == NotificacaoInconsistencia.TipoInconsistencia.LOCAL_DIVERGENTE:
        mensagem = f"Item {item.nome} lido fora do local esperado."
    elif inconsistencia.tipo == NotificacaoInconsistencia.TipoInconsistencia.NAO_ENCONTRADO:
        mensagem = f"Item {item.nome} não foi encontrado durante a auditoria."
    else:
        mensagem = f"Tag RFID desconhecida {inconsistencia.tag_id} lida durante a auditoria."

    evento = TimelineEvento.objects.create(
        item=item,
        tipo=TimelineEvento.TipoEvento.INCONSISTENCIA,
        mensagem=mensagem,
        usuario=admin_user if item else None,
        metadados={
            **(inconsistencia.metadados or {}),
            "inconsistencia_id": inconsistencia.id,
            "tipo": inconsistencia.tipo,
            "local_logico_nome": inconsistencia.local_logico.nome if inconsistencia.local_logico else None,
            "local_fisico_nome": inconsistencia.local_fisico.nome if inconsistencia.local_fisico else None,
        },
    )
    set_created(evento, when)


def audit_metadata(job, local, antena, event_name, tag_id) -> dict:
    return {
        "evento": event_name,
        "audit": True,
        "auditoria_job_id": job.id,
        "auditoria_execucao_id": f"job-{job.id}",
        "auditoria_criada_em": job.iniciado_em.isoformat(),
        "tag_id": tag_id,
        "local_id": local.id if local else None,
        "local_nome": local.nome if local else None,
        "antenna_id": antena.id,
        "antenna_nome": antena.nome,
        "source": "demo_tcc",
    }


def audit_item(item: ItemPatrimonial) -> dict:
    return {
        "id": item.id,
        "nome": item.nome,
        "tag_id": item.tag_id,
        "local_logico_nome": item.local_logico.nome if item.local_logico else None,
        "local_fisico_nome": item.local_fisico.nome if item.local_fisico else None,
    }


def set_created(instance, created_at) -> None:
    instance.__class__.objects.filter(pk=instance.pk).update(criado_em=created_at)
    instance.criado_em = created_at


def set_started(job: AuditoriaJob, started_at) -> None:
    AuditoriaJob.objects.filter(pk=job.pk).update(iniciado_em=started_at)
    job.iniciado_em = started_at


if __name__ == "__main__":
    main()
