from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0005_notificacaoinconsistencia_metadados_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="antenarfid",
            name="modo_comando",
            field=models.CharField(
                choices=[("polling", "Polling"), ("http", "HTTP direto")],
                default="polling",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="antenarfid",
            name="command_url",
            field=models.URLField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="antenarfid",
            name="command_token",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="antenarfid",
            name="duracao_padrao_segundos",
            field=models.PositiveIntegerField(default=5),
        ),
    ]
