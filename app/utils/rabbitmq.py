import os
import time
import json
import asyncio
import logging
from contextlib import contextmanager
import pika
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
load_dotenv(override=True)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")


class RabbitMQConnectionPool:
    """
    RabbitMQ connection manager.
    
    Rather than maintaining idle, un-heartbeated BlockingConnection sockets
    in a queue (which causes CloudAMQP / AWS load balancers to drop them after
    idle timeout with 'Socket EOF / RxEndOfFile'), this manager verifies
    connectivity at startup and creates resilient, on-demand connections.
    """
    def __init__(self, amqp_url: str, pool_size: int = 5):
        self.amqp_url = amqp_url
        self.pool_size = pool_size
        self.initialized = False

    def _get_connection_params(self) -> pika.URLParameters:
        params = pika.URLParameters(self.amqp_url)
        params.connection_attempts = 3
        params.retry_delay = 2
        params.socket_timeout = 10
        params.heartbeat = 600
        return params

    def init_pool(self):
        """Verifies RabbitMQ connectivity at startup without leaving stale idle sockets."""
        if self.initialized:
            return
        logger.info("Verifying RabbitMQ connection using configured URL...")
        try:
            params = self._get_connection_params()
            conn = pika.BlockingConnection(params)
            conn.close()
            logger.info("RabbitMQ connection verified successfully at startup.")
            self.initialized = True
        except Exception as e:
            logger.warning("RabbitMQ startup connection check failed (will retry on demand): %s", e)

    @contextmanager
    def get_connection(self):
        """Yields a fresh, healthy connection and closes it cleanly when done."""
        params = self._get_connection_params()
        conn = pika.BlockingConnection(params)
        try:
            yield conn
        finally:
            if conn and not conn.is_closed:
                try:
                    conn.close()
                except Exception:
                    pass

    def close_all(self):
        """No-op cleanup since connections are cleanly closed after each use."""
        self.initialized = False


# Global instance of RabbitMQ Connection Manager
rabbitmq_pool = RabbitMQConnectionPool(RABBITMQ_URL)


async def publish_to_processing_queue(meeting_id: str, max_retries: int = 3, base_delay: float = 1.0):
    """
    Publishes a JSON payload containing the meeting_id to the durable 'processing_queue'.
    Runs the blocking pika publisher in the event loop executor to avoid blocking FastAPI.
    Automatically retries on transient connection errors (e.g. Socket EOF, connection drop).
    """
    def _publish():
        last_error = None
        for attempt in range(1, max_retries + 1):
            conn = None
            try:
                params = pika.URLParameters(RABBITMQ_URL)
                params.connection_attempts = 3
                params.retry_delay = 1
                params.socket_timeout = 10
                params.heartbeat = 600

                conn = pika.BlockingConnection(params)
                channel = conn.channel()
                channel.queue_declare(queue="processing_queue", durable=True)

                payload = json.dumps({"meeting_id": meeting_id})
                channel.basic_publish(
                    exchange="",
                    routing_key="processing_queue",
                    body=payload,
                    properties=pika.BasicProperties(
                        delivery_mode=2,  # Make the message persistent on disk
                    ),
                )
                logger.info("Published meeting %s to processing_queue (attempt %d).", meeting_id, attempt)
                return True
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "RabbitMQ publish attempt %d/%d failed for meeting %s: %s",
                    attempt, max_retries, meeting_id, exc,
                )
                if attempt < max_retries:
                    time.sleep(base_delay * attempt)
            finally:
                if conn is not None and not conn.is_closed:
                    try:
                        conn.close()
                    except Exception:
                        pass

        logger.error("Failed to publish meeting %s to RabbitMQ after %d attempts: %s", meeting_id, max_retries, last_error)
        raise last_error

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _publish)

