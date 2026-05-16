from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_tecnicopermissoes"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="antenarfid",
            index=models.Index(fields=["online", "ativa"], name="antenna_online_active_idx"),
        ),
        migrations.AddIndex(
            model_name="leiturarfid",
            index=models.Index(fields=["tag_id", "criado_em"], name="reading_tag_created_idx"),
        ),
        migrations.AddIndex(
            model_name="leiturarfid",
            index=models.Index(fields=["classificacao", "criado_em"], name="reading_class_created_idx"),
        ),
        migrations.AddIndex(
            model_name="timelineevento",
            index=models.Index(fields=["criado_em", "tipo"], name="timeline_created_type_idx"),
        ),
        migrations.AddIndex(
            model_name="notificacaoinconsistencia",
            index=models.Index(fields=["resolvida", "tipo"], name="incons_open_type_idx"),
        ),
        migrations.AddIndex(
            model_name="notificacaoinconsistencia",
            index=models.Index(fields=["tag_id", "resolvida"], name="incons_tag_open_idx"),
        ),
    ]
