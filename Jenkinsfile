pipeline {
    agent any
    stages {
        stage('Checkout') {
            steps {
                sh 'git pull origin main'
            }
        }
        stage('OWASP Dependency-Check') {
            steps {
                dependencyCheck additionalArguments: '--scan ./ --out ./ --format XML --format HTML --data /var/jenkins_home/dependency-check-data --nvdApiDelay 10000', odcInstallation: 'DP-Check'
                sh 'ls -la'
                dependencyCheckPublisher pattern: '**/dependency-check-report.xml'
            }
        }
        stage('Build') {
            steps {
                sh 'docker build --pull --rm -f "Dockerfile" -t blog:latest "."'
            }
        }
        stage('Trivy') {
            steps {
                sh 'docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity HIGH,CRITICAL blog:latest'
            }
        }
        stage('Run') {
            steps {
                sh 'docker stop blog || true'
                sh 'docker rm blog || true'
                sh 'docker run -d -p 3000:3000 --name blog blog'
            }
        }
        stage('Nikto') {
            steps {
                 sh '''
                    docker run --rm --network container:blog sullo/nikto \
                        -h http://localhost:3000 \
                        -maxtime 5m \
                        -nointeractive > nikto-report.txt || true
                '''
                sh 'cat nikto-report.txt'
                archiveArtifacts artifacts: 'nikto-report.txt', allowEmptyArchive: true
            }
        }
    }
}