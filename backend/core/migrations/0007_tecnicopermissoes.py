from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_antenarfid_direct_command"),
    ]

    operations = [
        migrations.CreateModel(
            name="TecnicoPermissoes",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("gerenciar_cadastros", models.BooleanField(default=False)),
                ("acionar_leitores", models.BooleanField(default=True)),
                ("executar_auditoria", models.BooleanField(default=True)),
                ("resolver_inconsistencias", models.BooleanField(default=True)),
                ("ver_logs", models.BooleanField(default=True)),
                ("atualizado_em", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Permissoes do tecnico",
                "verbose_name_plural": "Permissoes do tecnico",
            },
        ),
    ]
