pipeline {
    agent any

    environment {
        DEPLOY_DIR = '/home/ubuntu/admission-management-app'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Test') {
            steps {
                sh '''
                    docker run --rm -v "$WORKSPACE/server":/app -w /app node:20-alpine \
                        sh -c "npm install && npm test"
                '''
            }
        }

        stage('Deploy') {
            steps {
                sh """
                    cd ${DEPLOY_DIR}
                    git pull
                    docker compose up -d --build
                """
            }
        }
    }

    post {
        success {
            echo 'Deployed successfully.'
        }
        failure {
            echo 'Pipeline failed — deployment was not updated.'
        }
    }
}
